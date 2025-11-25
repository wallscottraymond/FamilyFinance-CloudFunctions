"use strict";
/**
 * Remove Plaid Account Cloud Function
 *
 * Removes a Plaid-linked account by:
 * 1. Looking up account to get itemId
 * 2. Retrieving access token from plaid_items
 * 3. Calling Plaid itemRemove API to unlink
 * 4. Soft-deleting account (isActive: false)
 * 5. Optionally marking item inactive if no other accounts exist
 *
 * Security: User authentication required (VIEWER role)
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
exports.removePlaidAccount = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const auth_1 = require("../../../../utils/auth");
const index_1 = require("../../../../index");
const plaidClientFactory_1 = require("../../../../utils/plaidClientFactory");
const encryption_1 = require("../../../../utils/encryption");
const admin = __importStar(require("firebase-admin"));
// Define secrets for Plaid configuration
const plaidClientId = (0, params_1.defineSecret)('PLAID_CLIENT_ID');
const plaidSecret = (0, params_1.defineSecret)('PLAID_SECRET');
const tokenEncryptionKey = (0, params_1.defineSecret)('TOKEN_ENCRYPTION_KEY');
/**
 * Remove Plaid Account callable function
 */
exports.removePlaidAccount = (0, https_1.onCall)({
    memory: '256MiB',
    timeoutSeconds: 30,
    secrets: [plaidClientId, plaidSecret, tokenEncryptionKey],
}, async (request) => {
    try {
        // 1. Authenticate user
        const authResult = await (0, auth_1.authenticateRequest)(request, auth_1.UserRole.VIEWER);
        const userId = authResult.user.uid;
        const { accountId } = request.data;
        if (!accountId) {
            throw new https_1.HttpsError('invalid-argument', 'accountId is required');
        }
        console.log(`[removePlaidAccount] User ${userId} removing account ${accountId}`);
        // 2. Get account document
        const accountDoc = await index_1.db.collection('accounts').doc(accountId).get();
        if (!accountDoc.exists) {
            throw new https_1.HttpsError('not-found', 'Account not found');
        }
        const accountData = accountDoc.data();
        // 3. Verify ownership
        if ((accountData === null || accountData === void 0 ? void 0 : accountData.userId) !== userId) {
            throw new https_1.HttpsError('permission-denied', 'Not authorized to remove this account');
        }
        const itemId = accountData.itemId;
        if (!itemId) {
            throw new https_1.HttpsError('failed-precondition', 'Account has no associated Plaid item');
        }
        console.log(`[removePlaidAccount] Account ${accountId} linked to item ${itemId}`);
        // 4. Get plaid_items document for access token
        const itemDoc = await index_1.db.collection('plaid_items').doc(itemId).get();
        if (!itemDoc.exists) {
            throw new https_1.HttpsError('not-found', 'Plaid item not found');
        }
        const itemData = itemDoc.data();
        const encryptedAccessToken = itemData === null || itemData === void 0 ? void 0 : itemData.accessToken;
        if (!encryptedAccessToken) {
            throw new https_1.HttpsError('failed-precondition', 'Access token not found');
        }
        // 5. Decrypt access token
        const accessToken = (0, encryption_1.decryptAccessToken)(encryptedAccessToken);
        // 6. Call Plaid itemRemove API
        let plaidRemovalSuccess = false;
        try {
            const plaidClient = (0, plaidClientFactory_1.createStandardPlaidClient)();
            await plaidClient.itemRemove({ access_token: accessToken });
            console.log(`[removePlaidAccount] Successfully removed Plaid item ${itemId} via API`);
            plaidRemovalSuccess = true;
        }
        catch (plaidError) {
            console.error('[removePlaidAccount] Plaid itemRemove error:', plaidError);
            // Log the error but continue with soft delete
            // Item might already be removed on Plaid's side
            console.warn(`[removePlaidAccount] Continuing with soft delete despite Plaid API error`);
        }
        // 7. Soft delete account (mark as inactive)
        await index_1.db.collection('accounts').doc(accountId).update({
            isActive: false,
            isSyncEnabled: false,
            updatedAt: admin.firestore.Timestamp.now(),
        });
        console.log(`[removePlaidAccount] Marked account ${accountId} as inactive`);
        // 8. Check if other accounts use this itemId
        const otherAccountsQuery = await index_1.db
            .collection('accounts')
            .where('itemId', '==', itemId)
            .where('isActive', '==', true)
            .limit(1)
            .get();
        // 9. If no other active accounts, mark item as inactive
        if (otherAccountsQuery.empty) {
            await index_1.db.collection('plaid_items').doc(itemId).update({
                isActive: false,
                updatedAt: admin.firestore.Timestamp.now(),
            });
            console.log(`[removePlaidAccount] Marked Plaid item ${itemId} as inactive (no active accounts remaining)`);
        }
        else {
            console.log(`[removePlaidAccount] Plaid item ${itemId} still has ${otherAccountsQuery.size} active account(s)`);
        }
        return {
            success: true,
            message: 'Account removed successfully',
            accountId,
            itemId,
            plaidRemovalSuccess,
            itemStillActive: !otherAccountsQuery.empty,
        };
    }
    catch (error) {
        console.error('[removePlaidAccount] Error:', error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError('internal', error.message || 'Failed to remove account');
    }
});
//# sourceMappingURL=removePlaidAccount.js.map