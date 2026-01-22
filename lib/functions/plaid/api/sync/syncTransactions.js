"use strict";
/**
 * Plaid Transactions Sync Cloud Function
 *
 * Implements Plaid's /transactions/sync endpoint for real-time transaction synchronization.
 * This function is called when SYNC_UPDATES_AVAILABLE webhooks are received.
 *
 * Features:
 * - Uses Plaid's modern /transactions/sync endpoint
 * - Handles cursor-based pagination for incremental sync
 * - Stores raw Plaid transactions and converts to Family Finance format
 * - Manages transaction additions, modifications, and removals
 * - Implements proper error handling and retry logic
 *
 * Memory: 512MiB, Timeout: 300s (5 minutes)
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncTransactionsForItem = void 0;
exports.processWebhookTransactionSync = processWebhookTransactionSync;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const auth_1 = require("../../../../utils/auth");
const encryption_1 = require("../../../../utils/encryption");
const plaidClientFactory_1 = require("../../../../utils/plaidClientFactory");
const firestore_1 = require("../../../../utils/firestore");
const index_1 = require("../../../../index");
const firestore_2 = require("firebase-admin/firestore");
const formatTransactions_1 = require("../../../transactions/utils/formatTransactions");
const matchCategoriesToTransactions_1 = require("../../../transactions/utils/matchCategoriesToTransactions");
const matchTransactionSplitsToSourcePeriods_1 = require("../../../transactions/utils/matchTransactionSplitsToSourcePeriods");
const assignTransactionSplits_1 = require("../../../transactions/utils/assignTransactionSplits");
const matchTransactionSplitsToOutflows_1 = require("../../../transactions/utils/matchTransactionSplitsToOutflows");
const batchCreateTransactions_1 = require("../../../transactions/utils/batchCreateTransactions");
const documentStructure_1 = require("../../../../utils/documentStructure");
// Define secrets for Firebase configuration (still needed for function setup)
const plaidClientId = (0, params_1.defineSecret)('PLAID_CLIENT_ID');
const plaidSecret = (0, params_1.defineSecret)('PLAID_SECRET');
/**
 * Sync transactions for a specific Plaid item using /transactions/sync
 */
exports.syncTransactionsForItem = (0, https_1.onCall)({
    memory: '512MiB',
    timeoutSeconds: 300,
    secrets: [plaidClientId, plaidSecret],
}, async (request) => {
    var _a, _b, _c;
    try {
        // Authenticate user
        const authResult = await (0, auth_1.authenticateRequest)(request, auth_1.UserRole.VIEWER);
        const userId = authResult.user.uid;
        const { itemId } = request.data;
        if (!itemId) {
            throw new https_1.HttpsError('invalid-argument', 'itemId is required');
        }
        console.log(`🔄 Starting transaction sync for item: ${itemId}, user: ${userId}`);
        // Get the Plaid item and access token
        const itemDoc = await findPlaidItemByItemId(userId, itemId);
        if (!itemDoc) {
            throw new https_1.HttpsError('not-found', `Plaid item not found: ${itemId}`);
        }
        const encryptedAccessToken = itemDoc.accessToken;
        if (!encryptedAccessToken) {
            throw new https_1.HttpsError('failed-precondition', 'No access token found for item');
        }
        // Decrypt access token (handles both encrypted and plaintext for backward compatibility)
        const accessToken = (0, encryption_1.getAccessToken)(encryptedAccessToken);
        // Create Plaid client using centralized factory
        const plaidClient = (0, plaidClientFactory_1.createStandardPlaidClient)();
        // Get user and family context for transaction creation
        const userDoc = await (0, firestore_1.getDocument)('users', userId);
        if (!userDoc) {
            throw new https_1.HttpsError('not-found', `User not found: ${userId}`);
        }
        const familyId = userDoc.familyId;
        // Get family currency
        let currency = 'USD';
        if (familyId) {
            const familyDoc = await (0, firestore_1.getDocument)('families', familyId);
            if (familyDoc) {
                currency = ((_a = familyDoc.settings) === null || _a === void 0 ? void 0 : _a.currency) || 'USD';
            }
        }
        // Perform the sync (creates transactions with splits)
        const syncResult = await performTransactionSync(plaidClient, accessToken, itemId, userId, familyId, currency, itemDoc.cursor);
        // Update the item's cursor for next sync
        if (syncResult.nextCursor) {
            await updateItemCursor(itemDoc.id, syncResult.nextCursor);
        }
        console.log(`✅ Transaction sync completed for item ${itemId}:`, {
            added: syncResult.addedCount,
            modified: syncResult.modifiedCount,
            removed: syncResult.removedCount,
            nextCursor: syncResult.nextCursor
        });
        return {
            success: true,
            itemId,
            transactions: {
                added: syncResult.addedCount,
                modified: syncResult.modifiedCount,
                removed: syncResult.removedCount
            },
            nextCursor: syncResult.nextCursor,
            message: `Synced ${syncResult.addedCount + syncResult.modifiedCount} transactions`
        };
    }
    catch (error) {
        console.error('Error syncing transactions:', error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        // Check if this is a Plaid API error
        if ((_c = (_b = error.response) === null || _b === void 0 ? void 0 : _b.data) === null || _c === void 0 ? void 0 : _c.error_code) {
            const plaidError = error.response.data;
            throw new https_1.HttpsError('failed-precondition', `Plaid API Error: ${plaidError.error_code} - ${plaidError.error_message}`);
        }
        throw new https_1.HttpsError('internal', error.message || 'Failed to sync transactions');
    }
});
/**
 * Process webhook-triggered transaction sync (called by webhook handler)
 *
 * This is a wrapper around the main sync logic for webhook compatibility.
 * Uses the same unified transaction creation logic as manual sync.
 */
async function processWebhookTransactionSync(itemId, userId, itemDoc // Optional: pass item data directly from webhook
) {
    var _a, _b, _c;
    try {
        console.log(`🔄 Processing webhook transaction sync for item: ${itemId}, user: ${userId}`);
        // Use provided item data or look it up
        let resolvedItemDoc = itemDoc;
        if (!resolvedItemDoc) {
            resolvedItemDoc = await findPlaidItemByItemId(userId, itemId);
            if (!resolvedItemDoc) {
                throw new Error(`Plaid item not found: ${itemId}`);
            }
        }
        const encryptedAccessToken = resolvedItemDoc.accessToken;
        if (!encryptedAccessToken) {
            throw new Error('No access token found for item');
        }
        // Decrypt access token
        const accessToken = (0, encryption_1.getAccessToken)(encryptedAccessToken);
        // Create Plaid client
        const plaidClient = (0, plaidClientFactory_1.createStandardPlaidClient)();
        // Get user and family context for transaction creation
        const userDoc = await (0, firestore_1.getDocument)('users', userId);
        if (!userDoc) {
            throw new Error(`User not found: ${userId}`);
        }
        const familyId = userDoc.familyId;
        // Get family currency
        let currency = 'USD';
        if (familyId) {
            const familyDoc = await (0, firestore_1.getDocument)('families', familyId);
            if (familyDoc) {
                currency = ((_a = familyDoc.settings) === null || _a === void 0 ? void 0 : _a.currency) || 'USD';
            }
        }
        // Perform the unified sync (creates transactions with splits)
        const syncResult = await performTransactionSync(plaidClient, accessToken, itemId, userId, familyId, currency, resolvedItemDoc.cursor);
        // Update the item's cursor for next sync
        if (syncResult.nextCursor) {
            await updateItemCursor(resolvedItemDoc.id, syncResult.nextCursor);
        }
        console.log(`✅ Webhook transaction sync completed for item ${itemId}:`, {
            added: syncResult.addedCount,
            modified: syncResult.modifiedCount,
            removed: syncResult.removedCount
        });
        return {
            success: true,
            addedCount: syncResult.addedCount,
            modifiedCount: syncResult.modifiedCount,
            removedCount: syncResult.removedCount
        };
    }
    catch (error) {
        console.error(`❌ Error in webhook transaction sync for item ${itemId}:`, error);
        // Delegate error handling to centralized handler
        if ((_c = (_b = error.response) === null || _b === void 0 ? void 0 : _b.data) === null || _c === void 0 ? void 0 : _c.error_code) {
            console.log(`🔧 Delegating Plaid error handling for item ${itemId} to centralized handler`);
            const { handlePlaidErrorInternal } = await Promise.resolve().then(() => __importStar(require('../../utils/plaidErrorHandler')));
            try {
                await handlePlaidErrorInternal(itemId, userId, error, 'webhook-transaction-sync');
            }
            catch (handlerError) {
                console.error('Centralized error handler failed:', handlerError);
            }
        }
        return {
            success: false,
            addedCount: 0,
            modifiedCount: 0,
            removedCount: 0,
            error: error.message || 'Unknown sync error'
        };
    }
}
/**
 * Core transaction sync implementation using Plaid's /transactions/sync endpoint
 *
 * Creates transactions directly in the 'transactions' collection with proper splits.
 * This is the unified implementation used by both webhooks and manual sync.
 */
async function performTransactionSync(plaidClient, accessToken, itemId, userId, familyId, currency, cursor) {
    let addedCount = 0;
    let modifiedCount = 0;
    let removedCount = 0;
    let hasMore = true;
    let currentCursor = cursor;
    console.log(`🔄 Starting Plaid /transactions/sync for item ${itemId}, cursor: ${currentCursor || 'none'}`);
    while (hasMore) {
        try {
            // Call Plaid's /transactions/sync endpoint
            const syncRequest = {
                access_token: accessToken,
                cursor: currentCursor,
                count: 500, // Maximum allowed by Plaid
            };
            console.log(`📡 Calling Plaid /transactions/sync with cursor: ${currentCursor || 'initial'}`);
            const syncResponse = await plaidClient.transactionsSync(syncRequest);
            const data = syncResponse.data;
            console.log(`📥 Plaid sync response:`, {
                added: data.added.length,
                modified: data.modified.length,
                removed: data.removed.length,
                hasMore: data.has_more,
                nextCursor: data.next_cursor
            });
            // Process added transactions using new sequential pipeline
            if (data.added.length > 0) {
                console.log(`🔄 [performTransactionSync] Processing ${data.added.length} added transactions through sequential pipeline`);
                // Step 1: Format transactions (pure Plaid → Transaction mapping with nulls)
                const transactions = await (0, formatTransactions_1.formatTransactions)(data.added, itemId, userId, undefined, // groupId = null for now
                currency);
                console.log(`✅ Step 1/6: Formatted ${transactions.length} transactions`);
                // Step 2: Match transaction splits to categories (in-memory)
                const withCategories = await (0, matchCategoriesToTransactions_1.matchCategoriesToTransactions)(transactions, userId);
                console.log(`✅ Step 2/6: Matched categories for ${withCategories.length} transaction splits`);
                // Step 3: Match transaction splits to source periods (in-memory) - maps monthlyPeriodId, weeklyPeriodId, biWeeklyPeriodId
                const withPeriods = await (0, matchTransactionSplitsToSourcePeriods_1.matchTransactionSplitsToSourcePeriods)(withCategories);
                console.log(`✅ Step 3/6: Matched ${withPeriods.length} transaction splits to source periods (monthlyPeriodId, weeklyPeriodId, biWeeklyPeriodId)`);
                // Step 4: CENTRALIZED SPLIT ASSIGNMENT - Validate budgetIds, redistribute amounts, match to budgets
                const assignmentResults = await (0, assignTransactionSplits_1.assignTransactionSplitsBatch)(withPeriods, userId);
                const withBudgets = assignmentResults.map(r => r.transaction);
                const totalModified = assignmentResults.filter(r => r.modified).length;
                console.log(`✅ Step 4/6: Assigned budget IDs for ${withBudgets.length} transaction splits (${totalModified} validated/modified)`);
                // Step 5: Match outflow IDs to splits (in-memory)
                const { transactions: final, outflowUpdates } = await (0, matchTransactionSplitsToOutflows_1.matchTransactionSplitsToOutflows)(withBudgets, userId);
                console.log(`✅ Step 5/6: Matched outflow IDs for ${final.length} transaction splits (${outflowUpdates.length} outflow updates)`);
                // Step 6: Batch create transactions (single atomic operation)
                const count = await (0, batchCreateTransactions_1.batchCreateTransactions)(final, outflowUpdates);
                console.log(`✅ Step 6/6: Created ${count} transactions in Firebase`);
                addedCount += count;
            }
            // Process modified transactions
            if (data.modified.length > 0) {
                const modifiedResult = await processModifiedTransactions(data.modified, itemId, userId);
                modifiedCount += modifiedResult;
            }
            // Process removed transactions
            if (data.removed.length > 0) {
                const removedResult = await processRemovedTransactions(data.removed, itemId, userId);
                removedCount += removedResult;
            }
            // Update for next iteration
            hasMore = data.has_more;
            currentCursor = data.next_cursor;
            // Add small delay between requests to avoid rate limiting
            if (hasMore) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        catch (error) {
            console.error('Error in Plaid transactions sync:', error);
            throw error;
        }
    }
    return {
        addedCount,
        modifiedCount,
        removedCount,
        nextCursor: currentCursor
    };
}
/**
 * Process modified transactions from Plaid
 *
 * Checks if material data has changed (amount, date, category, pending status).
 * If material changes detected, re-runs the full 6-step pipeline to update:
 * - Categories
 * - Source period IDs (monthlyPeriodId, weeklyPeriodId, biWeeklyPeriodId)
 * - Budget IDs
 * - Outflow IDs
 *
 * If only minor changes (name, status), updates fields directly.
 */
async function processModifiedTransactions(modifiedTransactions, itemId, userId) {
    var _a;
    console.log(`🔄 Processing ${modifiedTransactions.length} modified transactions`);
    let processedCount = 0;
    const materialChanges = [];
    const minorChanges = [];
    try {
        // Step 1: Categorize changes as material or minor
        for (const transaction of modifiedTransactions) {
            // Find existing family transaction with Plaid transaction ID (using nested metadata structure)
            const existingQuery = await index_1.db.collection('transactions')
                .where('metadata.plaidTransactionId', '==', transaction.transaction_id)
                .where('userId', '==', userId)
                .limit(1)
                .get();
            if (!existingQuery.empty) {
                const existingDoc = existingQuery.docs[0];
                const existingData = existingDoc.data();
                // Check if material data has changed
                const hasMaterialChange = checkForMaterialChanges(transaction, existingData);
                if (hasMaterialChange) {
                    console.log(`🔄 Material change detected for transaction ${transaction.transaction_id} - will re-run pipeline`);
                    materialChanges.push(transaction);
                }
                else {
                    console.log(`✏️ Minor change detected for transaction ${transaction.transaction_id} - will update directly`);
                    minorChanges.push({ transaction, existingDoc });
                }
            }
        }
        // Step 2: Handle material changes - re-run full 6-step pipeline
        if (materialChanges.length > 0) {
            console.log(`🔄 Re-processing ${materialChanges.length} transactions with material changes through full pipeline`);
            // Get user context for currency
            const userDoc = await (0, firestore_1.getDocument)('users', userId);
            const familyId = userDoc === null || userDoc === void 0 ? void 0 : userDoc.familyId;
            let currency = 'USD';
            if (familyId) {
                const familyDoc = await (0, firestore_1.getDocument)('families', familyId);
                if (familyDoc) {
                    currency = ((_a = familyDoc.settings) === null || _a === void 0 ? void 0 : _a.currency) || 'USD';
                }
            }
            // Step 1: Format transactions
            const formattedTransactions = await (0, formatTransactions_1.formatTransactions)(materialChanges, itemId, userId, undefined, currency);
            console.log(`✅ Step 1/6: Formatted ${formattedTransactions.length} modified transactions`);
            // Step 2: Match categories
            const withCategories = await (0, matchCategoriesToTransactions_1.matchCategoriesToTransactions)(formattedTransactions, userId);
            console.log(`✅ Step 2/6: Matched categories for ${withCategories.length} transaction splits`);
            // Step 3: Match source periods (CRITICAL - re-match period IDs)
            const withPeriods = await (0, matchTransactionSplitsToSourcePeriods_1.matchTransactionSplitsToSourcePeriods)(withCategories);
            console.log(`✅ Step 3/6: Re-matched source periods for ${withPeriods.length} transaction splits`);
            // Step 4: CENTRALIZED SPLIT ASSIGNMENT - Validate budgetIds, redistribute amounts, match to budgets
            const assignmentResults = await (0, assignTransactionSplits_1.assignTransactionSplitsBatch)(withPeriods, userId);
            const withBudgets = assignmentResults.map(r => r.transaction);
            const totalModified = assignmentResults.filter(r => r.modified).length;
            console.log(`✅ Step 4/6: Re-matched budgets for ${withBudgets.length} transaction splits (${totalModified} validated/modified)`);
            // Step 5: Match outflows
            const { transactions: final, outflowUpdates } = await (0, matchTransactionSplitsToOutflows_1.matchTransactionSplitsToOutflows)(withBudgets, userId);
            console.log(`✅ Step 5/6: Re-matched outflows for ${final.length} transaction splits`);
            // Step 6: Update existing transactions (not create new ones)
            for (const updatedTransaction of final) {
                const plaidTxnId = updatedTransaction.transactionId;
                if (!plaidTxnId)
                    continue;
                // Find the existing transaction document
                const existingQuery = await index_1.db.collection('transactions')
                    .where('transactionId', '==', plaidTxnId)
                    .where('ownerId', '==', userId)
                    .limit(1)
                    .get();
                if (!existingQuery.empty) {
                    const existingDoc = existingQuery.docs[0];
                    // Update with all re-matched data
                    await existingDoc.ref.update({
                        description: updatedTransaction.description,
                        plaidPrimaryCategory: updatedTransaction.plaidPrimaryCategory,
                        plaidDetailedCategory: updatedTransaction.plaidDetailedCategory,
                        splits: updatedTransaction.splits, // This includes updated period IDs, budget IDs, outflow IDs
                        updatedAt: firestore_2.Timestamp.now(),
                        updatedBy: userId,
                    });
                    processedCount++;
                    console.log(`✅ Updated transaction ${plaidTxnId} with re-matched data (including period IDs)`);
                }
            }
            // Apply outflow updates if any
            if (outflowUpdates.length > 0) {
                const { FieldValue } = await Promise.resolve().then(() => __importStar(require('firebase-admin/firestore')));
                for (const update of outflowUpdates) {
                    const periodRef = index_1.db.collection('outflow_periods').doc(update.periodId);
                    await periodRef.update({
                        transactionSplits: FieldValue.arrayUnion(update.transactionSplitRef),
                        status: 'paid',
                        updatedAt: firestore_2.Timestamp.now()
                    });
                }
                console.log(`✅ Applied ${outflowUpdates.length} outflow period updates for modified transactions`);
            }
        }
        // Step 3: Handle minor changes - direct update
        for (const { transaction, existingDoc } of minorChanges) {
            const existingData = existingDoc.data();
            // Build update object using shared utility (ensures hybrid structure consistency)
            const updates = (0, documentStructure_1.buildPlaidTransactionUpdate)(transaction, existingData);
            // Apply the updates
            await existingDoc.ref.update(updates);
            processedCount++;
        }
        console.log(`✅ Updated ${processedCount} modified transactions (${materialChanges.length} with full pipeline, ${minorChanges.length} with direct updates)`);
        return processedCount;
    }
    catch (error) {
        console.error('Error processing modified transactions:', error);
        return processedCount;
    }
}
/**
 * Check if a transaction has material changes that require re-running the pipeline
 *
 * Material changes include:
 * - Amount change
 * - Date change
 * - Category change
 * - Pending status change (pending → posted)
 *
 * Non-material changes:
 * - Name/description updates
 * - Merchant name updates
 */
function checkForMaterialChanges(plaidTransaction, existingData) {
    var _a, _b, _c, _d;
    // Check amount change
    if (Math.abs(plaidTransaction.amount - existingData.amount) > 0.01) {
        console.log(`  💰 Amount changed: ${existingData.amount} → ${plaidTransaction.amount}`);
        return true;
    }
    // Check date change
    const newDate = firestore_2.Timestamp.fromDate(new Date(plaidTransaction.date));
    const existingDate = existingData.date;
    if (newDate.toMillis() !== existingDate.toMillis()) {
        console.log(`  📅 Date changed: ${existingDate.toDate()} → ${newDate.toDate()}`);
        return true;
    }
    // Check pending status change
    const newPending = plaidTransaction.pending || false;
    const existingPending = ((_a = existingData.metadata) === null || _a === void 0 ? void 0 : _a.pending) || false;
    if (newPending !== existingPending) {
        console.log(`  ⏳ Pending status changed: ${existingPending} → ${newPending}`);
        return true;
    }
    // Check category change (Plaid's category array)
    const newCategory = ((_b = plaidTransaction.personal_finance_category) === null || _b === void 0 ? void 0 : _b.primary) || ((_c = plaidTransaction.category) === null || _c === void 0 ? void 0 : _c[0]);
    const existingCategory = (_d = existingData.categories) === null || _d === void 0 ? void 0 : _d.primary;
    if (newCategory && newCategory !== existingCategory) {
        console.log(`  🏷️ Category changed: ${existingCategory} → ${newCategory}`);
        return true;
    }
    // No material changes detected
    return false;
}
/**
 * Process removed transactions from Plaid
 * Uses shared buildTransactionDeletionUpdate utility for consistency
 */
async function processRemovedTransactions(removedTransactions, itemId, userId) {
    console.log(`🗑️ Processing ${removedTransactions.length} removed transactions`);
    let processedCount = 0;
    try {
        for (const removedTransaction of removedTransactions) {
            // Find family transaction with Plaid transaction ID (using nested metadata structure)
            const existingQuery = await index_1.db.collection('transactions')
                .where('metadata.plaidTransactionId', '==', removedTransaction.transaction_id)
                .where('userId', '==', userId)
                .limit(1)
                .get();
            if (!existingQuery.empty) {
                const existingDoc = existingQuery.docs[0];
                // Build deletion update using shared utility (ensures hybrid structure consistency)
                const deletionUpdates = (0, documentStructure_1.buildTransactionDeletionUpdate)('Transaction removed by institution');
                // Apply soft delete instead of hard delete (preserves data for audit trail)
                await existingDoc.ref.update(deletionUpdates);
                processedCount++;
            }
        }
        console.log(`✅ Marked ${processedCount} transactions as deleted`);
        return processedCount;
    }
    catch (error) {
        console.error('Error processing removed transactions:', error);
        return processedCount;
    }
}
/**
 * Find Plaid item by itemId for a user
 */
async function findPlaidItemByItemId(userId, itemId) {
    try {
        // Try subcollection first
        const subCollectionQuery = await index_1.db.collection('users')
            .doc(userId)
            .collection('plaidItems')
            .where('plaidItemId', '==', itemId) // Fixed: use plaidItemId instead of itemId
            .where('isActive', '==', true)
            .limit(1)
            .get();
        if (!subCollectionQuery.empty) {
            const doc = subCollectionQuery.docs[0];
            const data = doc.data();
            return {
                id: doc.id,
                accessToken: data.accessToken,
                cursor: data.cursor,
                userId: data.userId,
                itemId: data.itemId,
                isActive: data.isActive
            };
        }
        // Try top-level collection
        const topLevelQuery = await index_1.db.collection('plaid_items')
            .where('plaidItemId', '==', itemId) // Fixed: use plaidItemId instead of itemId
            .where('userId', '==', userId)
            .where('isActive', '==', true)
            .limit(1)
            .get();
        if (!topLevelQuery.empty) {
            const doc = topLevelQuery.docs[0];
            const data = doc.data();
            return {
                id: doc.id,
                accessToken: data.accessToken,
                cursor: data.cursor,
                userId: data.userId,
                itemId: data.itemId,
                isActive: data.isActive
            };
        }
        return null;
    }
    catch (error) {
        console.error('Error finding Plaid item:', error);
        return null;
    }
}
/**
 * Update Plaid item's cursor for next sync
 */
async function updateItemCursor(itemDocId, cursor) {
    try {
        // We don't know if it's in subcollection or top-level, so we need to find it
        // This is a simplified approach - in production you'd want to track the location
        await index_1.db.collection('plaid_items').doc(itemDocId).update({
            cursor,
            lastSyncedAt: firestore_2.Timestamp.now(),
            updatedAt: firestore_2.Timestamp.now()
        });
        console.log(`✅ Updated cursor for item ${itemDocId}: ${cursor}`);
    }
    catch (error) {
        console.error('Error updating item cursor:', error);
        // Don't throw - cursor update failure shouldn't break the sync
    }
}
//# sourceMappingURL=syncTransactions.js.map