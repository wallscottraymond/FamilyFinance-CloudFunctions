"use strict";
/**
 * Plaid Account Management Utilities
 *
 * Handles account data retrieval and storage operations
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
exports.fetchPlaidAccounts = fetchPlaidAccounts;
exports.savePlaidItem = savePlaidItem;
exports.savePlaidAccounts = savePlaidAccounts;
const index_1 = require("../index");
const admin = __importStar(require("firebase-admin"));
const encryption_1 = require("./encryption");
const documentStructure_1 = require("./documentStructure");
/**
 * Retrieves account details from Plaid
 */
async function fetchPlaidAccounts(plaidClient, accessToken, itemId) {
    try {
        console.log('Fetching account details from Plaid...');
        const accountsRequest = {
            access_token: accessToken,
        };
        const accountsResponse = await plaidClient.accountsGet(accountsRequest);
        const plaidAccounts = accountsResponse.data.accounts;
        console.log('Retrieved account details from Plaid', {
            accountCount: plaidAccounts.length,
            itemId,
        });
        // Process account data
        const processedAccounts = plaidAccounts.map(account => ({
            id: account.account_id,
            name: account.name,
            type: account.type,
            subtype: account.subtype || null,
            currentBalance: account.balances.current || 0,
            availableBalance: account.balances.available,
            currencyCode: account.balances.iso_currency_code || 'USD',
            mask: account.mask,
            officialName: account.official_name,
        }));
        return processedAccounts;
    }
    catch (error) {
        console.error('Failed to fetch account details from Plaid:', error);
        throw new Error(`Account fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
/**
 * Saves Plaid item data to Firestore
 */
async function savePlaidItem(itemId, userId, institutionId, institutionName, accessToken) {
    try {
        console.log('Saving Plaid item to Firestore...', { itemId, institutionName });
        await index_1.db.collection('plaid_items').doc(itemId).set({
            id: itemId,
            plaidItemId: itemId,
            userId: userId,
            familyId: '', // TODO: Get user's familyId from userData
            institutionId: institutionId,
            institutionName: institutionName,
            institutionLogo: null,
            accessToken: (0, encryption_1.encryptAccessToken)(accessToken), // Encrypted for security
            cursor: null,
            products: ['transactions'],
            status: 'good',
            error: null,
            lastWebhookReceived: null,
            isActive: true,
            createdAt: admin.firestore.Timestamp.now(),
            updatedAt: admin.firestore.Timestamp.now(),
        });
        console.log('Successfully saved Plaid item to Firestore');
    }
    catch (error) {
        console.error('Failed to save Plaid item:', error);
        throw new Error(`Plaid item save failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
/**
 * Saves account documents to Firestore accounts collection using hybrid structure
 */
async function savePlaidAccounts(accounts, itemId, userId, institutionId, institutionName, groupId) {
    try {
        console.log(`Saving ${accounts.length} account documents to Firestore...`);
        for (const account of accounts) {
            try {
                console.log(`Building account: ${account.id} (${account.name}) - ${account.type}/${account.subtype}`);
                const now = admin.firestore.Timestamp.now();
                // Step 1: Build complete account structure with defaults
                // Convert single groupId to groupIds array
                const groupIds = groupId ? [groupId] : [];
                const accountDoc = {
                    // === QUERY-CRITICAL FIELDS AT ROOT (defaults) ===
                    id: account.id,
                    plaidAccountId: account.id,
                    accountId: account.id,
                    userId: userId,
                    groupIds,
                    isActive: true,
                    createdAt: now,
                    // === NESTED ACCESS CONTROL OBJECT (defaults) ===
                    access: (0, documentStructure_1.buildAccessControl)(userId, userId, groupIds),
                    // === NESTED CATEGORIES OBJECT ===
                    categories: {
                        primary: account.type,
                        secondary: account.subtype || undefined,
                        tags: [],
                        plaidPrimary: account.type,
                        plaidDetailed: account.subtype || undefined
                    },
                    // === NESTED METADATA OBJECT ===
                    metadata: (0, documentStructure_1.buildMetadata)(userId, 'plaid', {
                        plaidAccountId: account.id,
                        plaidItemId: itemId,
                        lastSyncedAt: now,
                        notes: `${institutionName} - ${account.name}`
                    }),
                    // === NESTED RELATIONSHIPS OBJECT ===
                    relationships: (0, documentStructure_1.buildRelationships)({
                        parentId: itemId,
                        parentType: 'plaid_item'
                    }),
                    // === ACCOUNT-SPECIFIC FIELDS AT ROOT ===
                    itemId: itemId,
                    institutionId: institutionId,
                    institutionName: institutionName,
                    accountName: account.name,
                    accountType: account.type,
                    accountSubtype: account.subtype,
                    mask: account.mask,
                    officialName: account.officialName,
                    currentBalance: account.currentBalance,
                    availableBalance: account.availableBalance,
                    limit: null,
                    isoCurrencyCode: account.currencyCode,
                    isSyncEnabled: true,
                    lastBalanceUpdate: now,
                    updatedAt: now,
                };
                // Log document creation
                console.log('Document created:', {
                    userId: accountDoc.userId,
                    groupIds,
                    groupCount: groupIds.length
                });
                // Save to Firestore
                await index_1.db.collection('accounts').doc(account.id).set(accountDoc);
                console.log(`Successfully saved account: ${account.id}`);
            }
            catch (accountError) {
                console.error(`Failed to save account ${account.id}:`, accountError);
                throw new Error(`Account save failed for ${account.id}: ${accountError instanceof Error ? accountError.message : 'Unknown error'}`);
            }
        }
        console.log(`Successfully saved all ${accounts.length} accounts to Firestore`);
    }
    catch (error) {
        console.error('Failed to save accounts to Firestore:', error);
        throw error; // Re-throw to maintain error context
    }
}
//# sourceMappingURL=plaidAccounts.js.map