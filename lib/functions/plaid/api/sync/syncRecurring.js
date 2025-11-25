"use strict";
/**
 * Sync Recurring Transactions Function
 *
 * Fetches recurring transaction streams from Plaid and stores them in
 * the inflow (recurring income) and outflow (recurring expenses) collections.
 *
 * Flow:
 * 1. Look up plaid_item by plaidItemId to get access token
 * 2. Call Plaid /transactions/recurring/get
 * 3. Store inflow streams in inflow collection
 * 4. Store outflow streams in outflow collection
 *
 * Memory: 512MiB, Timeout: 120s
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncRecurringTransactionsCallable = void 0;
exports.syncRecurringTransactions = syncRecurringTransactions;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const auth_1 = require("../../../../utils/auth");
const encryption_1 = require("../../../../utils/encryption");
const plaidClientFactory_1 = require("../../../../utils/plaidClientFactory");
const index_1 = require("../../../../index");
const firestore_1 = require("firebase-admin/firestore");
const formatRecurringInflows_1 = require("../../../inflows/utils/formatRecurringInflows");
const enhanceRecurringInflows_1 = require("../../../inflows/utils/enhanceRecurringInflows");
const formatRecurringOutflows_1 = require("../../../outflows/utils/formatRecurringOutflows");
const enhanceRecurringOutflows_1 = require("../../../outflows/utils/enhanceRecurringOutflows");
const batchCreateRecurringStreams_1 = require("../../../outflows/utils/batchCreateRecurringStreams");
// Define secrets
const plaidClientId = (0, params_1.defineSecret)('PLAID_CLIENT_ID');
const plaidSecret = (0, params_1.defineSecret)('PLAID_SECRET');
const tokenEncryptionKey = (0, params_1.defineSecret)('TOKEN_ENCRYPTION_KEY');
/**
 * Callable function for manual recurring transaction sync
 */
exports.syncRecurringTransactionsCallable = (0, https_1.onCall)({
    memory: '512MiB',
    timeoutSeconds: 120,
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
        console.log(`🔄 Manual recurring transaction sync requested for item: ${plaidItemId}, user: ${userId}`);
        const result = await syncRecurringTransactions(plaidItemId, userId);
        return Object.assign({ success: true }, result);
    }
    catch (error) {
        console.error('Error in manual recurring transaction sync:', error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError('internal', error.message || 'Failed to sync recurring transactions');
    }
});
/**
 * Internal sync recurring transactions function (called by trigger and callable function)
 *
 * @param plaidItemId - The Plaid item ID
 * @param userId - The user ID
 * @returns Sync result with inflow/outflow counts
 */
async function syncRecurringTransactions(plaidItemId, userId) {
    console.log(`🔄 Starting recurring transaction sync for item ${plaidItemId}, user ${userId}`);
    const result = {
        inflowsCreated: 0,
        inflowsUpdated: 0,
        outflowsCreated: 0,
        outflowsUpdated: 0,
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
        // Step 2: Call Plaid /transactions/recurring/get
        const plaidClient = (0, plaidClientFactory_1.createStandardPlaidClient)();
        console.log(`📡 Calling Plaid /transactions/recurring/get for item ${plaidItemId}`);
        const recurringResponse = await plaidClient.transactionsRecurringGet({
            access_token: accessToken,
        });
        const rawInflowStreams = recurringResponse.data.inflow_streams || [];
        const rawOutflowStreams = recurringResponse.data.outflow_streams || [];
        console.log(`📥 Retrieved ${rawInflowStreams.length} inflow streams and ${rawOutflowStreams.length} outflow streams`);
        // === INFLOW PIPELINE ===
        if (rawInflowStreams.length > 0) {
            console.log(`🔄 [syncRecurringTransactions] === STARTING INFLOW PIPELINE ===`);
            // Step 1: Format inflow streams (Plaid → Internal structure)
            const formattedInflows = await (0, formatRecurringInflows_1.formatRecurringInflows)(rawInflowStreams, plaidItemId, userId, itemData.familyId);
            console.log(`✅ Step 1/3: Formatted ${formattedInflows.length} inflow streams`);
            // Step 2: Enhance inflow streams (future transformations placeholder)
            const enhancedInflows = await (0, enhanceRecurringInflows_1.enhanceRecurringInflows)(formattedInflows, userId);
            console.log(`✅ Step 2/3: Enhanced ${enhancedInflows.length} inflow streams`);
            // Step 3: Batch create/update inflow streams
            const inflowResult = await (0, batchCreateRecurringStreams_1.batchCreateInflowStreams)(enhancedInflows, userId);
            console.log(`✅ Step 3/3: Created ${inflowResult.created} inflows, updated ${inflowResult.updated} inflows`);
            result.inflowsCreated = inflowResult.created;
            result.inflowsUpdated = inflowResult.updated;
            result.errors.push(...inflowResult.errors);
        }
        // === OUTFLOW PIPELINE ===
        if (rawOutflowStreams.length > 0) {
            console.log(`🔄 [syncRecurringTransactions] === STARTING OUTFLOW PIPELINE ===`);
            // Step 1: Format outflow streams (Plaid → Internal structure)
            const formattedOutflows = await (0, formatRecurringOutflows_1.formatRecurringOutflows)(rawOutflowStreams, plaidItemId, userId, itemData.familyId);
            console.log(`✅ Step 1/3: Formatted ${formattedOutflows.length} outflow streams`);
            // Step 2: Enhance outflow streams (future transformations placeholder)
            const enhancedOutflows = await (0, enhanceRecurringOutflows_1.enhanceRecurringOutflows)(formattedOutflows, userId);
            console.log(`✅ Step 2/3: Enhanced ${enhancedOutflows.length} outflow streams`);
            // Step 3: Batch create/update outflow streams
            const outflowResult = await (0, batchCreateRecurringStreams_1.batchCreateOutflowStreams)(enhancedOutflows, userId);
            console.log(`✅ Step 3/3: Created ${outflowResult.created} outflows, updated ${outflowResult.updated} outflows`);
            result.outflowsCreated = outflowResult.created;
            result.outflowsUpdated = outflowResult.updated;
            result.errors.push(...outflowResult.errors);
        }
        // Update the plaid_item with last recurring sync time
        await itemDoc.ref.update({
            lastRecurringSyncedAt: firestore_1.Timestamp.now(),
            updatedAt: firestore_1.Timestamp.now()
        });
        console.log(`✅ Recurring transaction sync completed:`, result);
        return result;
    }
    catch (error) {
        console.error(`❌ Error syncing recurring transactions for item ${plaidItemId}:`, error);
        result.errors.push(error.message || 'Unknown sync error');
        return result;
    }
}
//# sourceMappingURL=syncRecurring.js.map