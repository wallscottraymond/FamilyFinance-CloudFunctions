"use strict";
/**
 * Plaid Item Created Trigger
 *
 * Firestore trigger that automatically runs when a new plaid_item is created.
 * Orchestrates the complete Plaid data synchronization workflow:
 * 1. Sync account balances
 * 2. Sync transactions (with splits)
 * 3. Sync recurring transactions (inflow/outflow)
 *
 * This ensures all Plaid data is consistently synchronized whenever a user
 * links a new bank account.
 *
 * Memory: 1GiB, Timeout: 540s (9 minutes)
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
exports.onPlaidItemCreated = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const params_1 = require("firebase-functions/params");
const syncBalances_1 = require("../../api/sync/syncBalances");
const syncTransactions_1 = require("../../api/sync/syncTransactions");
const syncRecurring_1 = require("../../api/sync/syncRecurring");
// Define secrets for Plaid configuration
const plaidClientId = (0, params_1.defineSecret)('PLAID_CLIENT_ID');
const plaidSecret = (0, params_1.defineSecret)('PLAID_SECRET');
const tokenEncryptionKey = (0, params_1.defineSecret)('TOKEN_ENCRYPTION_KEY');
/**
 * Firestore trigger on plaid_items/{itemDocId}
 *
 * Automatically syncs all Plaid data when a new item is created
 */
exports.onPlaidItemCreated = (0, firestore_1.onDocumentCreated)({
    document: 'plaid_items/{itemDocId}',
    memory: '1GiB',
    timeoutSeconds: 540,
    secrets: [plaidClientId, plaidSecret, tokenEncryptionKey],
}, async (event) => {
    var _a;
    const itemDocId = event.params.itemDocId;
    const itemData = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
    if (!itemData) {
        console.error('No data found in plaid_item document');
        return;
    }
    const plaidItemId = itemData.plaidItemId;
    const userId = itemData.userId;
    console.log(`🎯 Plaid item created trigger fired for item ${plaidItemId}, user ${userId}`);
    try {
        // Step 1: Sync account balances
        console.log('📊 Step 1: Syncing account balances...');
        const balancesResult = await (0, syncBalances_1.syncBalances)(plaidItemId, userId);
        console.log('✅ Balances synced:', balancesResult);
        // Step 2: Sync transactions to transactions collection with splits
        console.log('💳 Step 2: Syncing transactions...');
        const transactionsResult = await (0, syncTransactions_1.processWebhookTransactionSync)(plaidItemId, userId, itemData);
        console.log('✅ Transactions synced:', transactionsResult);
        // Step 3: Sync recurring transactions to inflow/outflow collections
        console.log('🔄 Step 3: Syncing recurring transactions...');
        const recurringResult = await (0, syncRecurring_1.syncRecurringTransactions)(plaidItemId, userId);
        console.log('✅ Recurring transactions synced:', recurringResult);
        console.log(`🎉 Complete sync finished for item ${plaidItemId}:`, {
            accounts: balancesResult.accountsUpdated,
            transactionsAdded: transactionsResult.addedCount,
            transactionsModified: transactionsResult.modifiedCount,
            transactionsRemoved: transactionsResult.removedCount,
            recurringInflows: recurringResult.inflowsCreated,
            recurringOutflows: recurringResult.outflowsCreated
        });
    }
    catch (error) {
        console.error(`❌ Error during Plaid item sync for ${plaidItemId}:`, error);
        // Update the item with error status (optional - for debugging)
        try {
            const { db } = await Promise.resolve().then(() => __importStar(require('../../../../index')));
            await db.collection('plaid_items').doc(itemDocId).update({
                lastSyncError: error instanceof Error ? error.message : 'Unknown error',
                lastSyncErrorAt: new Date()
            });
        }
        catch (updateError) {
            console.error('Failed to update item with error status:', updateError);
        }
    }
});
//# sourceMappingURL=onPlaidItemCreated.js.map