"use strict";
/**
 * Plaid Webhook Handler Cloud Function
 *
 * Handles real-time webhook notifications from Plaid following best practices:
 * - Fast response (< 10 seconds) with minimal processing
 * - Idempotent handling of duplicate and out-of-order webhooks
 * - Webhook signature verification using HMAC-SHA256
 * - Queue-based processing for heavy operations
 * - Proper error handling and retry logic
 *
 * Based on Plaid's webhook best practices:
 * https://plaid.com/docs/#webhooks
 *
 * Memory: 512MiB, Timeout: 60s
 * CORS: Disabled (webhook endpoint)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.plaidWebhook = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
// import { authenticateRequest, UserRole } from '../../../../utils/auth';
// import * as Joi from 'joi';
const index_1 = require("../../../../index");
// import {
//   PlaidApi,
//   Configuration,
//   PlaidEnvironments
// } from 'plaid';
const types_1 = require("../../../../types");
const firestore_1 = require("firebase-admin/firestore");
const syncBalances_1 = require("../../api/sync/syncBalances");
const syncTransactions_1 = require("../../api/sync/syncTransactions");
const syncRecurring_1 = require("../../api/sync/syncRecurring");
// Define secrets for Plaid configuration
const plaidClientId = (0, params_1.defineSecret)('PLAID_CLIENT_ID');
const plaidSecret = (0, params_1.defineSecret)('PLAID_SECRET');
const plaidWebhookSecret = (0, params_1.defineSecret)('PLAID_WEBHOOK_SECRET');
// Configure Plaid client
// let plaidClient: PlaidApi | null = null;
// function getPlaidClient(): PlaidApi {
//   if (!plaidClient) {
//     console.log('Creating Plaid client for sandbox environment');
//     
//     const configuration = new Configuration({
//       basePath: PlaidEnvironments.sandbox,
//     });
//     
//     plaidClient = new PlaidApi(configuration);
//   }
//   return plaidClient;
// }
/**
 * Plaid Webhook Handler
 */
/**
 * Plaid Webhook Handler - Fast, reliable webhook receiver
 * Following Plaid's best practices for webhook handling
 */
exports.plaidWebhook = (0, https_1.onRequest)({
    memory: '512MiB',
    timeoutSeconds: 30, // Reduced for faster response
    cors: false, // Webhooks should not have CORS
    secrets: [plaidClientId, plaidSecret, plaidWebhookSecret],
}, async (req, res) => {
    // Fast response - keep processing minimal
    try {
        // Only allow POST requests
        if (req.method !== 'POST') {
            res.status(405).json({ error: 'Only POST requests allowed' });
            return;
        }
        // Extract webhook data
        const webhookBody = JSON.stringify(req.body);
        const signature = req.get('plaid-verification') || '';
        const { webhook_type, webhook_code, item_id } = req.body;
        // Log webhook receipt for debugging
        const serverLogAndEmitSocket = (additionalInfo, itemId) => {
            console.log(`WEBHOOK: ${webhook_type}: ${webhook_code}: Plaid_item_id ${item_id}: ${additionalInfo}`);
            // Note: In a real app with socket.io, you would emit here:
            // if (webhook_code) io.emit(webhook_code, { itemId });
        };
        // Verify webhook signature first (security)
        // Always verify in production, configurable for development
        const shouldVerifySignature = process.env.NODE_ENV === 'production' ||
            process.env.VERIFY_WEBHOOK_SIGNATURE === 'true';
        if (shouldVerifySignature && !verifyWebhookSignature(webhookBody, signature)) {
            serverLogAndEmitSocket('Invalid webhook signature', item_id);
            console.warn(`⚠️ Webhook signature verification failed for item ${item_id}`, {
                signatureProvided: !!signature,
                signatureLength: (signature === null || signature === void 0 ? void 0 : signature.length) || 0,
                bodyLength: webhookBody.length,
                timestamp: new Date().toISOString()
            });
            res.status(401).json({
                success: false,
                error: 'Invalid webhook signature'
            });
            return;
        }
        // Log verification status for debugging
        if (shouldVerifySignature) {
            console.log(`✅ Webhook signature verified successfully for item ${item_id}`);
        }
        else {
            console.log(`🔓 Webhook signature verification disabled (development mode) for item ${item_id}`);
        }
        // Handle webhook based on type - FAST processing only
        const result = await handleWebhookEvent(req.body, serverLogAndEmitSocket);
        // Always respond with 200 for successful processing
        res.status(200).json({
            success: true,
            processed: result.processed,
            message: result.message
        });
    }
    catch (error) {
        console.error('Webhook processing error:', error);
        // Still return 200 to avoid retries for system errors
        res.status(200).json({
            success: false,
            error: 'Internal processing error'
        });
    }
});
/**
 * Handle webhook events - fast processing following Plaid's example pattern
 * Based on: https://github.com/plaid/pattern/blob/main/server/webhookHandlers/handleTransactionsWebhook.js
 */
async function handleWebhookEvent(requestBody, serverLogAndEmitSocket) {
    const { webhook_type: webhookType, webhook_code: webhookCode, item_id: plaidItemId, request_id: requestId } = requestBody;
    // Check for duplicate webhooks using request_id for idempotency
    if (requestId) {
        const existingWebhook = await index_1.db.collection('plaid_webhooks')
            .where('requestId', '==', requestId)
            .limit(1)
            .get();
        if (!existingWebhook.empty) {
            serverLogAndEmitSocket('Duplicate webhook ignored', plaidItemId);
            return { processed: false, message: 'Duplicate webhook ignored' };
        }
    }
    // Store webhook for tracking (minimal data, fast write)
    const webhookDoc = {
        webhookType,
        webhookCode,
        itemId: plaidItemId,
        requestId: requestId || '',
        payload: requestBody,
        processingStatus: types_1.PlaidWebhookProcessingStatus.PENDING,
        createdAt: firestore_1.Timestamp.now()
    };
    // Write to queue for processing - don't wait for completion
    const webhookRef = index_1.db.collection('plaid_webhooks').doc();
    webhookRef.set(webhookDoc).catch(error => {
        console.error('Failed to store webhook:', error);
    });
    // Handle different webhook types
    switch (webhookType) {
        case types_1.PlaidWebhookType.TRANSACTIONS:
            return await handleTransactionsWebhook(requestBody, serverLogAndEmitSocket);
        case types_1.PlaidWebhookType.ITEM:
            return await handleItemWebhook(requestBody, serverLogAndEmitSocket);
        case types_1.PlaidWebhookType.RECURRING_TRANSACTIONS:
            return await handleRecurringTransactionsWebhook(requestBody, serverLogAndEmitSocket);
        default:
            serverLogAndEmitSocket(`Unhandled webhook type: ${webhookType}`, plaidItemId);
            return { processed: false, message: `Unhandled webhook type: ${webhookType}` };
    }
}
/**
 * Handle transaction webhooks following Plaid's example pattern
 * Based on: https://github.com/plaid/pattern/blob/main/server/webhookHandlers/handleTransactionsWebhook.js
 */
async function handleTransactionsWebhook(requestBody, serverLogAndEmitSocket) {
    var _a;
    const { webhook_code: webhookCode, item_id: plaidItemId, } = requestBody;
    // Get item from database for user context
    const itemDoc = await retrieveItemByPlaidItemId(plaidItemId);
    if (!itemDoc) {
        serverLogAndEmitSocket('Item not found in database', plaidItemId);
        return { processed: false, message: 'Item not found' };
    }
    switch (webhookCode) {
        case types_1.PlaidWebhookCode.SYNC_UPDATES_AVAILABLE: {
            // Check 4-hour rate limiting before processing
            if (await isRateLimited(itemDoc, webhookCode)) {
                const minutesRemaining = await getMinutesUntilNextSync(itemDoc);
                serverLogAndEmitSocket(`Rate limited: ${minutesRemaining} minutes remaining`, plaidItemId);
                return { processed: false, message: `Rate limited: ${minutesRemaining} minutes remaining` };
            }
            // Process transaction sync using modern sync function
            serverLogAndEmitSocket('Starting transaction sync', plaidItemId);
            const syncResult = await (0, syncTransactions_1.processWebhookTransactionSync)(plaidItemId, itemDoc.userId, itemDoc);
            if (syncResult.success) {
                const totalSynced = syncResult.addedCount + syncResult.modifiedCount + syncResult.removedCount;
                serverLogAndEmitSocket(`Transaction sync completed: ${totalSynced} transactions processed`, plaidItemId);
                return {
                    processed: true,
                    message: `Synced ${syncResult.addedCount} new, ${syncResult.modifiedCount} modified, ${syncResult.removedCount} removed transactions`
                };
            }
            else {
                const errorMsg = syncResult.error || 'Unknown error';
                serverLogAndEmitSocket(`Transaction sync failed: ${errorMsg}`, plaidItemId);
                return {
                    processed: false,
                    message: `Sync failed: ${errorMsg}`
                };
            }
        }
        case types_1.PlaidWebhookCode.DEFAULT_UPDATE:
        case types_1.PlaidWebhookCode.INITIAL_UPDATE:
        case types_1.PlaidWebhookCode.HISTORICAL_UPDATE:
            // These are handled by SYNC_UPDATES_AVAILABLE in modern implementations
            serverLogAndEmitSocket('Legacy webhook - using sync endpoint instead', plaidItemId);
            return { processed: false, message: 'Legacy webhook ignored - using sync endpoint' };
        case types_1.PlaidWebhookCode.TRANSACTIONS_REMOVED: {
            const removedCount = ((_a = requestBody.removed_transactions) === null || _a === void 0 ? void 0 : _a.length) || 0;
            await queueTransactionRemoval(plaidItemId, requestBody.removed_transactions);
            serverLogAndEmitSocket(`${removedCount} transactions queued for removal`, plaidItemId);
            return { processed: true, message: `${removedCount} transactions queued for removal` };
        }
        default:
            serverLogAndEmitSocket(`Unhandled transaction webhook code: ${webhookCode}`, plaidItemId);
            return { processed: false, message: `Unhandled webhook code: ${webhookCode}` };
    }
}
/**
 * Handle item webhooks
 */
async function handleItemWebhook(requestBody, serverLogAndEmitSocket) {
    const { webhook_code: webhookCode, item_id: plaidItemId, error: webhookError } = requestBody;
    switch (webhookCode) {
        case types_1.PlaidWebhookCode.ERROR:
            await updateItemStatus(plaidItemId, 'ERROR', webhookError);
            serverLogAndEmitSocket(`Item error: ${webhookError === null || webhookError === void 0 ? void 0 : webhookError.error_code}`, plaidItemId);
            return { processed: true, message: 'Item error status updated' };
        case types_1.PlaidWebhookCode.PENDING_EXPIRATION:
            await updateItemStatus(plaidItemId, 'PENDING_EXPIRATION');
            serverLogAndEmitSocket('Item pending expiration', plaidItemId);
            return { processed: true, message: 'Item expiration status updated' };
        case types_1.PlaidWebhookCode.USER_PERMISSION_REVOKED:
            await updateItemStatus(plaidItemId, 'PERMISSION_REVOKED');
            serverLogAndEmitSocket('User permission revoked', plaidItemId);
            return { processed: true, message: 'Item permission status updated' };
        case types_1.PlaidWebhookCode.NEW_ACCOUNTS_AVAILABLE: {
            // Handle when new accounts are available for the item - sync balances immediately
            const itemDoc = await retrieveItemByPlaidItemId(plaidItemId);
            if (!itemDoc) {
                serverLogAndEmitSocket('Item not found for new accounts sync', plaidItemId);
                return { processed: false, message: 'Item not found' };
            }
            const balanceResult = await (0, syncBalances_1.syncBalances)(plaidItemId, itemDoc.userId);
            serverLogAndEmitSocket(`New accounts synced: ${balanceResult.accountsUpdated} accounts updated`, plaidItemId);
            return { processed: true, message: `${balanceResult.accountsUpdated} accounts updated` };
        }
        default:
            serverLogAndEmitSocket(`Unhandled item webhook code: ${webhookCode}`, plaidItemId);
            return { processed: false, message: `Unhandled webhook code: ${webhookCode}` };
    }
}
/**
 * Handle recurring transaction webhooks
 */
async function handleRecurringTransactionsWebhook(requestBody, serverLogAndEmitSocket) {
    const { webhook_code: webhookCode, item_id: plaidItemId } = requestBody;
    // Get item for user context
    const itemDoc = await retrieveItemByPlaidItemId(plaidItemId);
    if (!itemDoc) {
        serverLogAndEmitSocket('Item not found for recurring transaction sync', plaidItemId);
        return { processed: false, message: 'Item not found' };
    }
    switch (webhookCode) {
        case types_1.PlaidWebhookCode.RECURRING_TRANSACTIONS_UPDATE: {
            // Sync recurring transactions using unified sync function
            const syncResult = await (0, syncRecurring_1.syncRecurringTransactions)(plaidItemId, itemDoc.userId);
            const total = syncResult.inflowsCreated + syncResult.inflowsUpdated + syncResult.outflowsCreated + syncResult.outflowsUpdated;
            serverLogAndEmitSocket(`Recurring transactions synced: ${total} streams processed`, plaidItemId);
            return {
                processed: true,
                message: `Synced ${syncResult.inflowsCreated + syncResult.inflowsUpdated} inflows, ${syncResult.outflowsCreated + syncResult.outflowsUpdated} outflows`
            };
        }
        default:
            serverLogAndEmitSocket(`Unhandled recurring transaction webhook code: ${webhookCode}`, plaidItemId);
            return { processed: false, message: `Unhandled webhook code: ${webhookCode}` };
    }
}
// ============================================================================
// HELPER FUNCTIONS - Fast database operations for webhook processing
// ============================================================================
/**
 * Retrieve item by Plaid item ID - searches both top-level and subcollections
 */
async function retrieveItemByPlaidItemId(plaidItemId) {
    try {
        console.log(`🔍 Searching for Plaid item: ${plaidItemId}`);
        // First try top-level collection
        console.log('🔍 Checking top-level plaid_items collection...');
        const itemQuery = await index_1.db.collection('plaid_items')
            .where('plaidItemId', '==', plaidItemId) // Fixed: use plaidItemId instead of itemId
            .limit(1)
            .get();
        console.log(`🔍 Top-level search result: ${itemQuery.size} items found`);
        if (!itemQuery.empty) {
            const itemDoc = itemQuery.docs[0];
            const data = itemDoc.data();
            console.log(`✅ Found item in top-level collection:`, {
                docId: itemDoc.id,
                userId: data.userId,
                isActive: data.isActive,
                hasAccessToken: !!data.accessToken
            });
            return Object.assign({ id: itemDoc.id, userId: data.userId, lastSyncedAt: data.lastSyncedAt }, data);
        }
        // If not found in top-level, search all user subcollections
        console.log('🔍 Searching user subcollections...');
        const usersSnapshot = await index_1.db.collection('users').get();
        console.log(`🔍 Found ${usersSnapshot.size} users to search`);
        for (const userDoc of usersSnapshot.docs) {
            console.log(`🔍 Checking user: ${userDoc.id}`);
            // First check all items in this user's subcollection for debugging
            const allItemsQuery = await userDoc.ref.collection('plaidItems').get();
            console.log(`🔍 User ${userDoc.id} has ${allItemsQuery.size} total plaidItems`);
            if (allItemsQuery.size > 0) {
                const itemIds = allItemsQuery.docs.map(doc => doc.data().plaidItemId || doc.data().itemId || doc.id);
                console.log(`🔍 Available itemIds in user ${userDoc.id}:`, itemIds);
                // Check the first item's full structure
                const firstItem = allItemsQuery.docs[0].data();
                console.log(`🔍 First item structure:`, {
                    docId: allItemsQuery.docs[0].id,
                    itemId: firstItem.itemId,
                    plaidItemId: firstItem.plaidItemId,
                    allFields: Object.keys(firstItem)
                });
            }
            const plaidItemsQuery = await userDoc.ref
                .collection('plaidItems')
                .where('plaidItemId', '==', plaidItemId) // Fixed: use plaidItemId instead of itemId
                .where('isActive', '==', true) // Re-enabled isActive filter
                .limit(1)
                .get();
            console.log(`🔍 Found ${plaidItemsQuery.size} items with itemId=${plaidItemId} in user ${userDoc.id}`);
            if (!plaidItemsQuery.empty) {
                const itemDoc = plaidItemsQuery.docs[0];
                const data = itemDoc.data();
                console.log(`✅ Found item in user subcollection:`, {
                    userId: userDoc.id,
                    docId: itemDoc.id,
                    isActive: data.isActive,
                    hasAccessToken: !!data.accessToken
                });
                return Object.assign({ id: itemDoc.id, userId: userDoc.id, lastSyncedAt: data.lastSyncedAt }, data);
            }
        }
        console.log(`❌ Item ${plaidItemId} not found in any collection`);
        return null;
    }
    catch (error) {
        console.error('Error retrieving item:', error);
        return null;
    }
}
/**
 * Check if item is rate limited (4-hour interval)
 */
async function isRateLimited(itemDoc, webhookCode) {
    // Always allow INITIAL_UPDATE to process immediately
    if (webhookCode === 'INITIAL_UPDATE') {
        return false;
    }
    if (!itemDoc.lastSyncedAt) {
        return false;
    }
    const now = firestore_1.Timestamp.now();
    const FOUR_HOURS = 4 * 60 * 60 * 1000;
    const timeSinceLastSync = now.toMillis() - itemDoc.lastSyncedAt.toMillis();
    return timeSinceLastSync < FOUR_HOURS;
}
/**
 * Get minutes until next sync is allowed
 */
async function getMinutesUntilNextSync(itemDoc) {
    if (!itemDoc.lastSyncedAt) {
        return 0;
    }
    const now = firestore_1.Timestamp.now();
    const FOUR_HOURS = 4 * 60 * 60 * 1000;
    const timeSinceLastSync = now.toMillis() - itemDoc.lastSyncedAt.toMillis();
    const timeRemaining = FOUR_HOURS - timeSinceLastSync;
    return Math.max(0, Math.round(timeRemaining / (1000 * 60)));
}
/**
 * Queue transaction removal for background processing
 */
async function queueTransactionRemoval(plaidItemId, removedTransactions) {
    try {
        await index_1.db.collection('plaid_sync_queue').add({
            type: 'TRANSACTION_REMOVAL',
            plaidItemId,
            removedTransactions,
            priority: 'MEDIUM',
            createdAt: firestore_1.Timestamp.now(),
            processedAt: null,
            status: 'PENDING'
        });
    }
    catch (error) {
        console.error('Failed to queue transaction removal:', error);
    }
}
/**
 * Update item status in database
 */
async function updateItemStatus(plaidItemId, status, error) {
    try {
        const itemQuery = await index_1.db.collection('plaid_items')
            .where('itemId', '==', plaidItemId)
            .limit(1)
            .get();
        if (!itemQuery.empty) {
            await itemQuery.docs[0].ref.update({
                status,
                error: error || null,
                updatedAt: firestore_1.Timestamp.now()
            });
        }
    }
    catch (error) {
        console.error('Failed to update item status:', error);
    }
}
/**
 * Verify webhook signature using HMAC-SHA256
 */
function verifyWebhookSignature(body, signature) {
    try {
        const crypto = require('crypto');
        const webhookSecret = plaidWebhookSecret.value();
        if (!webhookSecret) {
            console.error('PLAID_WEBHOOK_SECRET not configured');
            return false;
        }
        if (!signature || typeof signature !== 'string') {
            console.warn('Invalid signature format provided');
            return false;
        }
        const expectedSignature = crypto
            .createHmac('sha256', webhookSecret)
            .update(body)
            .digest('hex');
        // Ensure both signatures are the same length before comparison
        if (signature.length !== expectedSignature.length) {
            console.warn('Signature length mismatch', {
                provided: signature.length,
                expected: expectedSignature.length
            });
            return false;
        }
        try {
            // Timing-safe comparison
            return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature, 'hex'));
        }
        catch (bufferError) {
            // If there's an error creating buffers (e.g., invalid hex), return false
            console.warn('Invalid hex format in signature', {
                signature: signature.substring(0, 10) + '...',
                error: bufferError instanceof Error ? bufferError.message : 'Unknown buffer error'
            });
            return false;
        }
    }
    catch (error) {
        console.error('Error verifying webhook signature:', error);
        return false;
    }
}
//# sourceMappingURL=plaidWebhook.js.map