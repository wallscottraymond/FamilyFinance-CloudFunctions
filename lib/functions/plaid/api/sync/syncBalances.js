"use strict";
/**
 * Sync Balances Function
 *
 * Fetches current account balances from Plaid and updates the accounts collection.
 * This function is called by the onPlaidItemCreated trigger and can also be
 * called manually for balance refreshes.
 *
 * Flow:
 * 1. Look up plaid_item by plaidItemId to get access token
 * 2. Call Plaid /accounts/balance/get
 * 3. Update accounts collection with latest balances
 *
 * Memory: 256MiB, Timeout: 60s
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncBalancesCallable = void 0;
exports.syncBalances = syncBalances;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const auth_1 = require("../../../../utils/auth");
const encryption_1 = require("../../../../utils/encryption");
const plaidClientFactory_1 = require("../../../../utils/plaidClientFactory");
const index_1 = require("../../../../index");
const firestore_1 = require("firebase-admin/firestore");
// Define secrets
const plaidClientId = (0, params_1.defineSecret)('PLAID_CLIENT_ID');
const plaidSecret = (0, params_1.defineSecret)('PLAID_SECRET');
const tokenEncryptionKey = (0, params_1.defineSecret)('TOKEN_ENCRYPTION_KEY');
/**
 * Callable function for manual balance sync
 */
exports.syncBalancesCallable = (0, https_1.onCall)({
    memory: '256MiB',
    timeoutSeconds: 60,
    secrets: [plaidClientId, plaidSecret, tokenEncryptionKey],
}, async (request) => {
    try {
        // Authenticate user
        const authResult = await (0, auth_1.authenticateRequest)(request, auth_1.UserRole.VIEWER);
        const userId = authResult.user.uid;
        const { plaidItemId } = request.data;
        if (!plaidItemId) {
            throw new https_1.HttpsError('invalid-argument', 'plaidItemId is required');
        }
        console.log(`🔄 Manual balance sync requested for item: ${plaidItemId}, user: ${userId}`);
        const result = await syncBalances(plaidItemId, userId);
        return Object.assign({ success: true }, result);
    }
    catch (error) {
        console.error('Error in manual balance sync:', error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError('internal', error.message || 'Failed to sync balances');
    }
});
/**
 * Internal sync balances function (called by trigger and callable function)
 *
 * @param plaidItemId - The Plaid item ID
 * @param userId - The user ID (for validation)
 * @returns Sync result with account counts
 */
async function syncBalances(plaidItemId, userId) {
    console.log(`📊 Starting balance sync for item ${plaidItemId}, user ${userId}`);
    const result = {
        accountsUpdated: 0,
        errors: []
    };
    try {
        // Step 1: Find the plaid_item to get access token
        const itemQuery = await index_1.db.collection('plaid_items')
            .where('plaidItemId', '==', plaidItemId)
            .where('userId', '==', userId)
            .where('isActive', '==', true)
            .limit(1)
            .get();
        if (itemQuery.empty) {
            throw new Error(`Plaid item not found: ${plaidItemId}`);
        }
        const itemDoc = itemQuery.docs[0];
        const itemData = itemDoc.data();
        const encryptedAccessToken = itemData.accessToken;
        if (!encryptedAccessToken) {
            throw new Error('No access token found for item');
        }
        // Decrypt access token
        const accessToken = (0, encryption_1.getAccessToken)(encryptedAccessToken);
        // Step 2: Create Plaid client and fetch balances
        const plaidClient = (0, plaidClientFactory_1.createStandardPlaidClient)();
        const balanceRequest = {
            access_token: accessToken
        };
        console.log(`📡 Calling Plaid /accounts/balance/get for item ${plaidItemId}`);
        const balanceResponse = await plaidClient.accountsBalanceGet(balanceRequest);
        const accounts = balanceResponse.data.accounts;
        console.log(`📥 Retrieved ${accounts.length} accounts from Plaid`);
        // Step 3: Update each account in the accounts collection
        for (const plaidAccount of accounts) {
            try {
                // Find the account document
                const accountQuery = await index_1.db.collection('accounts')
                    .where('plaidAccountId', '==', plaidAccount.account_id)
                    .where('userId', '==', userId)
                    .limit(1)
                    .get();
                if (accountQuery.empty) {
                    console.warn(`Account not found in accounts collection: ${plaidAccount.account_id}`);
                    result.errors.push(`Account ${plaidAccount.account_id} not found`);
                    continue;
                }
                const accountDoc = accountQuery.docs[0];
                // Update balance information
                await accountDoc.ref.update({
                    balance: plaidAccount.balances.current,
                    availableBalance: plaidAccount.balances.available,
                    limit: plaidAccount.balances.limit,
                    isoCurrencyCode: plaidAccount.balances.iso_currency_code,
                    lastBalanceUpdate: firestore_1.Timestamp.now(),
                    updatedAt: firestore_1.Timestamp.now()
                });
                result.accountsUpdated++;
                console.log(`✅ Updated balance for account ${plaidAccount.name}: ${plaidAccount.balances.current}`);
            }
            catch (error) {
                const errorMsg = `Failed to update account ${plaidAccount.account_id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
                result.errors.push(errorMsg);
                console.error(errorMsg);
            }
        }
        // Update the plaid_item with last sync time
        await itemDoc.ref.update({
            lastBalanceSyncedAt: firestore_1.Timestamp.now(),
            updatedAt: firestore_1.Timestamp.now()
        });
        console.log(`✅ Balance sync completed: ${result.accountsUpdated} accounts updated`);
        return result;
    }
    catch (error) {
        console.error(`❌ Error syncing balances for item ${plaidItemId}:`, error);
        result.errors.push(error.message || 'Unknown sync error');
        return result;
    }
}
//# sourceMappingURL=syncBalances.js.map