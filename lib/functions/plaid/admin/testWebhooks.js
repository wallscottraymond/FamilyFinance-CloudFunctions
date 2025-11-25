"use strict";
/**
 * Plaid Webhook Testing Functions
 *
 * These functions trigger Plaid webhooks in the sandbox environment for testing purposes.
 * Based on Plaid's sandbox webhook endpoints:
 * - /sandbox/item/fire_webhook
 * - /sandbox/income/fire_webhook
 * - /sandbox/transfer/fire_webhook
 *
 * IMPORTANT NOTES:
 * - Sandbox items may not have webhooks configured, resulting in SANDBOX_WEBHOOK_INVALID errors
 * - ITEM_LOGIN_REQUIRED errors indicate items need re-authentication via Plaid Link update mode
 * - These functions are for development testing only and should not be used in production
 * - Webhook testing requires active Plaid items with valid access tokens
 *
 * Memory: 256MiB, Timeout: 30s
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
exports.getUserPlaidItems = exports.fireItemWebhook = exports.fireIncomeWebhook = exports.fireTransactionWebhook = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const auth_1 = require("../../../utils/auth");
const index_1 = require("../../../index");
const plaidClientFactory_1 = require("../../../utils/plaidClientFactory");
// Define secrets for Plaid configuration
const plaidClientId = (0, params_1.defineSecret)('PLAID_CLIENT_ID');
const plaidSecret = (0, params_1.defineSecret)('PLAID_SECRET');
// Use centralized Plaid client factory
function getPlaidClient() {
    return (0, plaidClientFactory_1.createStandardPlaidClient)();
}
/**
 * Helper function to find a Plaid item by itemId across different storage locations
 */
async function findPlaidItem(userId, itemId) {
    // Strategy 1: Try direct document lookup using itemId as document ID
    try {
        console.log(`🔍 Strategy 1: Looking for item ${itemId} as document ID in subcollection for user ${userId}`);
        const itemDoc = await index_1.db.collection('users')
            .doc(userId)
            .collection('plaidItems')
            .doc(itemId)
            .get();
        console.log(`🔍 Document exists: ${itemDoc.exists}`);
        if (itemDoc.exists) {
            const data = itemDoc.data();
            console.log(`🔍 Item data:`, {
                isActive: data === null || data === void 0 ? void 0 : data.isActive,
                institutionName: data === null || data === void 0 ? void 0 : data.institutionName,
                hasAccessToken: !!(data === null || data === void 0 ? void 0 : data.accessToken),
                allFields: Object.keys(data || {})
            });
            // Check if item is active
            if ((data === null || data === void 0 ? void 0 : data.isActive) === false) {
                console.log(`⚠️ Item ${itemId} exists but is not active`);
                return null;
            }
            console.log(`✅ Found active item ${itemId} in subcollection for user ${userId}`);
            return itemDoc;
        }
        else {
            console.log(`❌ Item ${itemId} not found as document ID in subcollection`);
        }
    }
    catch (error) {
        console.log('❌ Subcollection document lookup failed:', error);
    }
    // Strategy 2: Query by itemId field in subcollection
    try {
        console.log(`🔍 Strategy 2: Searching by itemId field in subcollection`);
        const itemQuery = await index_1.db.collection('users')
            .doc(userId)
            .collection('plaidItems')
            .where('itemId', '==', itemId)
            .where('isActive', '==', true)
            .limit(1)
            .get();
        console.log(`🔍 Query by itemId field result: ${itemQuery.size} documents found`);
        if (!itemQuery.empty) {
            const itemDoc = itemQuery.docs[0];
            console.log(`✅ Found item ${itemId} by itemId field in subcollection for user ${userId}`);
            return itemDoc;
        }
    }
    catch (error) {
        console.log('❌ Subcollection itemId query failed:', error);
    }
    // Strategy 3: Query by plaidItemId field in subcollection
    try {
        console.log(`🔍 Strategy 3: Searching by plaidItemId field in subcollection`);
        const itemQuery = await index_1.db.collection('users')
            .doc(userId)
            .collection('plaidItems')
            .where('plaidItemId', '==', itemId)
            .where('isActive', '==', true)
            .limit(1)
            .get();
        console.log(`🔍 Query by plaidItemId field result: ${itemQuery.size} documents found`);
        if (!itemQuery.empty) {
            const itemDoc = itemQuery.docs[0];
            console.log(`✅ Found item ${itemId} by plaidItemId field in subcollection for user ${userId}`);
            return itemDoc;
        }
    }
    catch (error) {
        console.log('❌ Subcollection plaidItemId query failed:', error);
    }
    // Strategy 4: Direct lookup in top-level plaid_items collection using itemId as document ID
    try {
        console.log(`🔍 Strategy 4: Direct lookup in plaid_items collection`);
        const itemDoc = await index_1.db.collection('plaid_items')
            .doc(itemId)
            .get();
        console.log(`🔍 Document exists: ${itemDoc.exists}`);
        if (itemDoc.exists) {
            const data = itemDoc.data();
            console.log(`🔍 Item data:`, {
                userId: data === null || data === void 0 ? void 0 : data.userId,
                isActive: data === null || data === void 0 ? void 0 : data.isActive,
                institutionName: data === null || data === void 0 ? void 0 : data.institutionName,
                hasAccessToken: !!(data === null || data === void 0 ? void 0 : data.accessToken),
                allFields: Object.keys(data || {})
            });
            // Verify this item belongs to the user
            if ((data === null || data === void 0 ? void 0 : data.userId) === userId) {
                console.log(`✅ Found item ${itemId} in plaid_items collection for user ${userId}`);
                return itemDoc;
            }
            else {
                console.log(`❌ Item ${itemId} exists but belongs to different user (expected: ${userId}, actual: ${data === null || data === void 0 ? void 0 : data.userId})`);
            }
        }
        else {
            console.log(`❌ Item ${itemId} not found as document ID in plaid_items collection`);
        }
    }
    catch (error) {
        console.log('❌ plaid_items document lookup failed:', error);
    }
    // Final attempt: List all items for this user to see what we actually have
    try {
        console.log(`🔍 Final debug: listing all plaidItems for user ${userId}...`);
        const allItemsQuery = await index_1.db.collection('users')
            .doc(userId)
            .collection('plaidItems')
            .get();
        console.log(`🔍 Total items found for user: ${allItemsQuery.size}`);
        allItemsQuery.docs.forEach((doc, index) => {
            const data = doc.data();
            console.log(`🔍 Item ${index + 1}: docId=${doc.id}, isActive=${data === null || data === void 0 ? void 0 : data.isActive}, institution=${data === null || data === void 0 ? void 0 : data.institutionName}`);
        });
    }
    catch (listError) {
        console.log(`❌ Error listing items for debug:`, listError);
    }
    console.log(`❌ Item ${itemId} not found anywhere for user ${userId}`);
    return null;
}
/**
 * Fire a transaction webhook for testing
 */
exports.fireTransactionWebhook = (0, https_1.onCall)({
    memory: '256MiB',
    timeoutSeconds: 30,
    secrets: [plaidClientId, plaidSecret],
}, async (request) => {
    var _a, _b;
    // Declare variables outside try block so they're accessible in catch block
    let userId;
    let itemId;
    try {
        // Authenticate user (any authenticated user can test their own webhooks)
        const authResult = await (0, auth_1.authenticateRequest)(request, auth_1.UserRole.VIEWER);
        userId = authResult.user.uid;
        const requestData = request.data;
        itemId = requestData.itemId;
        const webhookCode = requestData.webhookCode;
        if (!itemId) {
            throw new https_1.HttpsError('invalid-argument', 'itemId is required');
        }
        // Validate webhook code
        const validCodes = [
            'SYNC_UPDATES_AVAILABLE',
            'HISTORICAL_UPDATE',
            'INITIAL_UPDATE',
            'DEFAULT_UPDATE',
            'TRANSACTIONS_REMOVED'
        ];
        if (!webhookCode || !validCodes.includes(webhookCode)) {
            throw new https_1.HttpsError('invalid-argument', `Invalid webhook code. Valid codes: ${validCodes.join(', ')}`);
        }
        // Get the access token for this item
        const itemDoc = await findPlaidItem(userId, itemId);
        if (!itemDoc) {
            // Add debug info to help diagnose the issue
            const debugInfo = {
                userId,
                itemId,
                searchPaths: [
                    `users/${userId}/plaidItems/${itemId}`,
                    `plaid_items where itemId=${itemId} and userId=${userId}`
                ]
            };
            throw new https_1.HttpsError('not-found', `Plaid item not found. Debug: ${JSON.stringify(debugInfo)}`);
        }
        const itemData = itemDoc.data();
        if (!itemData) {
            throw new https_1.HttpsError('not-found', 'Plaid item data not found');
        }
        // Note: In a real implementation, you would decrypt the access token
        const accessToken = itemData.accessToken;
        // Fire the webhook
        const client = getPlaidClient();
        const fireWebhookRequest = {
            access_token: accessToken,
            webhook_code: webhookCode,
        };
        const response = await client.sandboxItemFireWebhook(fireWebhookRequest);
        console.log(`Fired ${webhookCode} webhook for item ${itemId}:`, response.data);
        return {
            success: true,
            message: `Successfully fired ${webhookCode} webhook for item ${itemId}`,
            webhook_fired: true,
            webhook_code: webhookCode,
            item_id: itemId
        };
    }
    catch (error) {
        console.error('Error firing transaction webhook:', error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        // Check if this is a Plaid API error that requires re-authentication
        if ((_b = (_a = error.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.error_code) {
            const plaidError = error.response.data;
            // Delegate error handling to centralized handler
            if (itemId && userId) {
                console.log(`🔧 Delegating Plaid error handling for item ${itemId} to centralized handler`);
                // Import and call the handler directly (same runtime context)
                const { handlePlaidErrorInternal } = await Promise.resolve().then(() => __importStar(require('../utils/plaidErrorHandler')));
                // Fire-and-forget error handling - don't await to avoid delaying error response
                handlePlaidErrorInternal(itemId, userId, error, 'fire-transaction-webhook').catch(err => console.error('Centralized error handler failed:', err));
            }
            throw new https_1.HttpsError('failed-precondition', `Plaid API Error: ${plaidError.error_code} - ${plaidError.error_message}`);
        }
        throw new https_1.HttpsError('internal', error.message || 'Failed to fire webhook');
    }
});
/**
 * Fire an income webhook for testing
 */
exports.fireIncomeWebhook = (0, https_1.onCall)({
    memory: '256MiB',
    timeoutSeconds: 30,
    secrets: [plaidClientId, plaidSecret],
}, async (request) => {
    var _a, _b;
    try {
        // Authenticate user (any authenticated user can test their own webhooks)
        const authResult = await (0, auth_1.authenticateRequest)(request, auth_1.UserRole.VIEWER);
        const userId = authResult.user.uid;
        const { itemId, webhookCode } = request.data;
        if (!itemId) {
            throw new https_1.HttpsError('invalid-argument', 'itemId is required');
        }
        // Validate webhook code
        const validCodes = [
            'RECURRING_TRANSACTIONS_UPDATE',
            'SYNC_UPDATES_AVAILABLE'
        ];
        if (!webhookCode || !validCodes.includes(webhookCode)) {
            throw new https_1.HttpsError('invalid-argument', `Invalid webhook code. Valid codes: ${validCodes.join(', ')}`);
        }
        // Get the access token for this item
        const itemDoc = await findPlaidItem(userId, itemId);
        if (!itemDoc) {
            throw new https_1.HttpsError('not-found', 'Plaid item not found');
        }
        const itemData = itemDoc.data();
        if (!itemData) {
            throw new https_1.HttpsError('not-found', 'Plaid item data not found');
        }
        const accessToken = itemData.accessToken;
        // Fire the income webhook using the item webhook endpoint
        // (Plaid uses the same endpoint for recurring transactions)
        const client = getPlaidClient();
        const fireWebhookRequest = {
            access_token: accessToken,
            webhook_code: webhookCode,
        };
        const response = await client.sandboxItemFireWebhook(fireWebhookRequest);
        console.log(`Fired ${webhookCode} income webhook for item ${itemId}:`, response.data);
        return {
            success: true,
            message: `Successfully fired ${webhookCode} income webhook for item ${itemId}`,
            webhook_fired: true,
            webhook_code: webhookCode,
            item_id: itemId
        };
    }
    catch (error) {
        console.error('Error firing income webhook:', error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        // Check if this is a Plaid API error and provide more helpful message
        if ((_b = (_a = error.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.error_code) {
            const plaidError = error.response.data;
            throw new https_1.HttpsError('failed-precondition', `Plaid API Error: ${plaidError.error_code} - ${plaidError.error_message}`);
        }
        throw new https_1.HttpsError('internal', error.message || 'Failed to fire income webhook');
    }
});
/**
 * Fire an item webhook for testing
 */
exports.fireItemWebhook = (0, https_1.onCall)({
    memory: '256MiB',
    timeoutSeconds: 30,
    secrets: [plaidClientId, plaidSecret],
}, async (request) => {
    var _a, _b;
    try {
        // Authenticate user (any authenticated user can test their own webhooks)
        const authResult = await (0, auth_1.authenticateRequest)(request, auth_1.UserRole.VIEWER);
        const userId = authResult.user.uid;
        const { itemId, webhookCode } = request.data;
        if (!itemId) {
            throw new https_1.HttpsError('invalid-argument', 'itemId is required');
        }
        // Validate webhook code for item webhooks
        const validCodes = [
            'ERROR',
            'PENDING_EXPIRATION',
            'USER_PERMISSION_REVOKED',
            'NEW_ACCOUNTS_AVAILABLE'
        ];
        if (!webhookCode || !validCodes.includes(webhookCode)) {
            throw new https_1.HttpsError('invalid-argument', `Invalid webhook code. Valid codes: ${validCodes.join(', ')}`);
        }
        // Get the access token for this item
        const itemDoc = await findPlaidItem(userId, itemId);
        if (!itemDoc) {
            throw new https_1.HttpsError('not-found', 'Plaid item not found');
        }
        const itemData = itemDoc.data();
        if (!itemData) {
            throw new https_1.HttpsError('not-found', 'Plaid item data not found');
        }
        const accessToken = itemData.accessToken;
        // Fire the item webhook using the transaction webhook endpoint
        // (Plaid uses the same endpoint for item webhooks)
        const client = getPlaidClient();
        const fireWebhookRequest = {
            access_token: accessToken,
            webhook_code: webhookCode,
        };
        const response = await client.sandboxItemFireWebhook(fireWebhookRequest);
        console.log(`Fired ${webhookCode} item webhook for item ${itemId}:`, response.data);
        return {
            success: true,
            message: `Successfully fired ${webhookCode} item webhook for item ${itemId}`,
            webhook_fired: true,
            webhook_code: webhookCode,
            item_id: itemId
        };
    }
    catch (error) {
        console.error('Error firing item webhook:', error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        // Check if this is a Plaid API error and provide more helpful message
        if ((_b = (_a = error.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.error_code) {
            const plaidError = error.response.data;
            throw new https_1.HttpsError('failed-precondition', `Plaid API Error: ${plaidError.error_code} - ${plaidError.error_message}`);
        }
        throw new https_1.HttpsError('internal', error.message || 'Failed to fire item webhook');
    }
});
/**
 * Get user's Plaid items for webhook testing
 */
exports.getUserPlaidItems = (0, https_1.onCall)({
    memory: '256MiB',
    timeoutSeconds: 30,
}, async (request) => {
    try {
        // Authenticate user
        const authResult = await (0, auth_1.authenticateRequest)(request, auth_1.UserRole.VIEWER);
        const userId = authResult.user.uid;
        // Get user's Plaid items - try subcollection first (matches mobile app)
        let itemsQuery;
        try {
            // First try the subcollection approach (same as mobile app)
            itemsQuery = await index_1.db.collection('users')
                .doc(userId)
                .collection('plaidItems')
                .where('isActive', '==', true)
                .get();
            console.log(`Found ${itemsQuery.size} items in subcollection for user ${userId}`);
        }
        catch (error) {
            console.log('Subcollection query failed, trying top-level collection:', error);
        }
        // If no items found in subcollection, try top-level collection
        if (!itemsQuery || itemsQuery.empty) {
            itemsQuery = await index_1.db.collection('plaid_items')
                .where('userId', '==', userId)
                .where('isActive', '==', true)
                .get();
            console.log(`Found ${itemsQuery.size} items in top-level collection for user ${userId}`);
        }
        const items = itemsQuery.docs.map(doc => {
            var _a;
            const data = doc.data();
            console.log(`🔍 Processing Plaid item ${doc.id}:`, {
                itemId: data.itemId,
                institutionName: data.institutionName,
                hasAccounts: !!data.accounts,
                accountsLength: ((_a = data.accounts) === null || _a === void 0 ? void 0 : _a.length) || 0,
                accountsData: data.accounts,
                allFields: Object.keys(data)
            });
            // Use itemId field if it exists, otherwise fall back to document ID
            const actualItemId = data.itemId || doc.id;
            return {
                id: doc.id,
                itemId: actualItemId,
                institutionName: data.institutionName,
                institutionId: data.institutionId,
                accounts: data.accounts || [],
                status: data.status || 'ACTIVE',
                lastSyncedAt: data.lastSyncedAt
            };
        });
        return {
            success: true,
            items,
            count: items.length
        };
    }
    catch (error) {
        console.error('Error getting user Plaid items:', error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError('internal', error.message || 'Failed to get Plaid items');
    }
});
//# sourceMappingURL=testWebhooks.js.map