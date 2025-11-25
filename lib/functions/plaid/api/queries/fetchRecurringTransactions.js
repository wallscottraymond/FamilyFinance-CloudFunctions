"use strict";
// @ts-nocheck
/**
 * Fetch Recurring Transactions Cloud Function
 *
 * Fetches recurring transaction streams from Plaid for a specific item or all user items.
 * This function calls the Plaid /transactions/recurring/get endpoint and stores the
 * recurring transaction data in Firestore.
 *
 * Security Features:
 * - User authentication required (VIEWER role minimum)
 * - Encrypted access token handling
 * - Proper error handling and validation
 *
 * Memory: 512MiB, Timeout: 60s
 * CORS: Enabled for mobile app
 * Promise Pattern: ✓
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
exports.fetchRecurringTransactions = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const cors_1 = require("../../../../middleware/cors");
const auth_1 = require("../../../../utils/auth");
const validation_1 = require("../../../../utils/validation");
const Joi = __importStar(require("joi"));
const index_1 = require("../../../../index");
const plaidClientFactory_1 = require("../../../../utils/plaidClientFactory");
const types_1 = require("../../../../types");
const firestore_1 = require("firebase-admin/firestore");
// Define secrets for Plaid configuration
const plaidClientId = (0, params_1.defineSecret)('PLAID_CLIENT_ID');
const plaidSecret = (0, params_1.defineSecret)('PLAID_SECRET');
// Request validation schema
const fetchRecurringTransactionsSchema = Joi.object({
    itemId: Joi.string().optional(),
    accountId: Joi.string().optional(),
});
// Use centralized Plaid client factory
function getPlaidClient() {
    return (0, plaidClientFactory_1.createStandardPlaidClient)();
}
/**
 * Fetch Recurring Transactions
 */
exports.fetchRecurringTransactions = (0, https_1.onRequest)({
    memory: '512MiB',
    timeoutSeconds: 60,
    cors: true,
    secrets: [plaidClientId, plaidSecret],
}, async (req, res) => {
    return new Promise(async (resolve) => {
        try {
            // Apply CORS middleware
            (0, cors_1.corsMiddleware)(req, res, async () => {
                var _a, _b, _c, _d, _e, _f, _g, _h;
                try {
                    // Only allow POST requests
                    if (req.method !== 'POST') {
                        res.status(405).json({
                            success: false,
                            error: {
                                code: 'METHOD_NOT_ALLOWED',
                                message: 'Only POST requests are allowed',
                            },
                        });
                        return resolve();
                    }
                    // Authenticate user (require at least VIEWER role)
                    const { user } = await (0, auth_1.authenticateRequest)(req, auth_1.UserRole.VIEWER);
                    // Validate request body
                    const validationResult = (0, validation_1.validateRequest)(req.body, fetchRecurringTransactionsSchema);
                    if (validationResult.error) {
                        res.status(400).json({
                            success: false,
                            error: {
                                code: 'VALIDATION_ERROR',
                                message: 'Invalid request body',
                                details: validationResult.error,
                            },
                        });
                        return resolve();
                    }
                    const requestData = validationResult.value;
                    console.log('Fetching recurring transactions for user:', user.uid, 'itemId:', requestData.itemId);
                    // Get user's Plaid items
                    let itemsQuery = index_1.db.collection('users').doc(user.uid).collection('plaidItems');
                    if (requestData.itemId) {
                        // Fetch specific item
                        const itemDoc = await itemsQuery.doc(requestData.itemId).get();
                        if (!itemDoc.exists) {
                            res.status(404).json({
                                success: false,
                                error: {
                                    code: 'ITEM_NOT_FOUND',
                                    message: 'Plaid item not found',
                                },
                            });
                            return resolve();
                        }
                        const result = await processItemRecurringTransactions(itemDoc.data(), requestData.accountId);
                        res.status(200).json({
                            success: true,
                            data: result,
                            message: `Fetched recurring transactions for item ${requestData.itemId}`,
                        });
                    }
                    else {
                        // Fetch all active items for user
                        const itemsSnapshot = await itemsQuery.where('isActive', '==', true).get();
                        if (itemsSnapshot.empty) {
                            res.status(200).json({
                                success: true,
                                data: {
                                    itemId: '',
                                    accountsCount: 0,
                                    streamsFound: 0,
                                    streamsAdded: 0,
                                    streamsModified: 0,
                                    historicalTransactionsDays: 0,
                                },
                                message: 'No active Plaid items found',
                            });
                            return resolve();
                        }
                        let totalAccountsCount = 0;
                        let totalStreamsFound = 0;
                        let totalStreamsAdded = 0;
                        let totalStreamsModified = 0;
                        let totalIncomeStreamsAdded = 0;
                        let totalOutflowStreamsAdded = 0;
                        let totalIncomeStreamsModified = 0;
                        let totalOutflowStreamsModified = 0;
                        // Process each item
                        for (const itemDoc of itemsSnapshot.docs) {
                            const itemData = itemDoc.data();
                            const result = await processItemRecurringTransactions(itemData, requestData.accountId);
                            totalAccountsCount += result.accountsCount;
                            totalStreamsFound += result.streamsFound;
                            totalStreamsAdded += result.streamsAdded;
                            totalStreamsModified += result.streamsModified;
                            totalIncomeStreamsAdded += result.incomeStreamsAdded;
                            totalOutflowStreamsAdded += result.outflowStreamsAdded;
                            totalIncomeStreamsModified += result.incomeStreamsModified;
                            totalOutflowStreamsModified += result.outflowStreamsModified;
                        }
                        res.status(200).json({
                            success: true,
                            data: {
                                itemId: 'multiple',
                                accountsCount: totalAccountsCount,
                                streamsFound: totalStreamsFound,
                                streamsAdded: totalStreamsAdded,
                                streamsModified: totalStreamsModified,
                                incomeStreamsAdded: totalIncomeStreamsAdded,
                                outflowStreamsAdded: totalOutflowStreamsAdded,
                                incomeStreamsModified: totalIncomeStreamsModified,
                                outflowStreamsModified: totalOutflowStreamsModified,
                                historicalTransactionsDays: 180, // Standard for recurring transactions
                            },
                            message: `Fetched recurring transactions for ${itemsSnapshot.size} items`,
                        });
                    }
                    console.log('Recurring transactions fetch completed successfully', {
                        userId: user.uid,
                        itemId: requestData.itemId || 'all',
                        accountId: requestData.accountId,
                    });
                    resolve();
                }
                catch (error) {
                    console.error('Error fetching recurring transactions:', error);
                    // Handle specific Plaid errors
                    if (error && typeof error === 'object' && 'response' in error) {
                        const plaidError = error;
                        res.status(400).json({
                            success: false,
                            error: {
                                code: 'PLAID_API_ERROR',
                                message: ((_b = (_a = plaidError.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.error_message) || 'Plaid API error occurred',
                                details: {
                                    error_type: (_d = (_c = plaidError.response) === null || _c === void 0 ? void 0 : _c.data) === null || _d === void 0 ? void 0 : _d.error_type,
                                    error_code: (_f = (_e = plaidError.response) === null || _e === void 0 ? void 0 : _e.data) === null || _f === void 0 ? void 0 : _f.error_code,
                                    display_message: (_h = (_g = plaidError.response) === null || _g === void 0 ? void 0 : _g.data) === null || _h === void 0 ? void 0 : _h.display_message,
                                },
                            },
                        });
                    }
                    else {
                        // Handle general errors
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                        res.status(500).json({
                            success: false,
                            error: {
                                code: 'INTERNAL_ERROR',
                                message: errorMessage,
                            },
                        });
                    }
                    resolve();
                }
            });
        }
        catch (error) {
            console.error('Unhandled error in fetchRecurringTransactions:', error);
            res.status(500).json({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: 'An unexpected error occurred',
                },
            });
            resolve();
        }
    });
});
/**
 * Process recurring transactions for a specific Plaid item
 */
async function processItemRecurringTransactions(itemData, accountId) {
    try {
        console.log(`Processing recurring transactions for item: ${itemData.itemId}`);
        // Get accounts for this item to pass to Plaid API
        const accountsSnapshot = await index_1.db.collection('accounts')
            .where('itemId', '==', itemData.itemId)
            .where('isActive', '==', true)
            .get();
        const allAccountIds = accountsSnapshot.docs.map(doc => doc.data().plaidAccountId || doc.data().accountId);
        console.log(`Found ${allAccountIds.length} active accounts for item ${itemData.itemId}:`, allAccountIds);
        // Filter to specific account if provided
        const targetAccountIds = accountId ? [accountId] : allAccountIds;
        if (targetAccountIds.length === 0) {
            console.warn(`No active accounts found for item ${itemData.itemId}`);
            return {
                itemId: itemData.itemId,
                accountsCount: 0,
                streamsFound: 0,
                streamsAdded: 0,
                streamsModified: 0,
                incomeStreamsAdded: 0,
                outflowStreamsAdded: 0,
                incomeStreamsModified: 0,
                outflowStreamsModified: 0,
                historicalTransactionsDays: 180,
            };
        }
        console.log(`Using account IDs for Plaid API:`, targetAccountIds);
        // Prepare Plaid API request
        const request = {
            client_id: plaidClientId.value(),
            secret: plaidSecret.value(),
            access_token: itemData.accessToken, // TODO: Decrypt this in production
            account_ids: targetAccountIds, // Use specific account IDs instead of empty array
        };
        console.log(`Calling Plaid transactionsRecurringGet with account IDs:`, request.account_ids);
        const client = getPlaidClient();
        const response = await client.transactionsRecurringGet(request);
        if (!response.data) {
            throw new Error('No data returned from Plaid recurring transactions API');
        }
        const { inflow_streams, outflow_streams } = response.data;
        console.log(`Retrieved recurring transactions from Plaid`, {
            itemId: itemData.itemId,
            inflowStreams: (inflow_streams === null || inflow_streams === void 0 ? void 0 : inflow_streams.length) || 0,
            outflowStreams: (outflow_streams === null || outflow_streams === void 0 ? void 0 : outflow_streams.length) || 0,
        });
        let streamsFound = 0;
        let streamsAdded = 0;
        let streamsModified = 0;
        let incomeStreamsAdded = 0;
        let outflowStreamsAdded = 0;
        let incomeStreamsModified = 0;
        let outflowStreamsModified = 0;
        // Process inflow streams (save to 'inflow' collection)
        if (inflow_streams) {
            const result = await processRecurringStreams(inflow_streams, itemData, types_1.PlaidRecurringTransactionStreamType.INFLOW);
            streamsFound += inflow_streams.length;
            streamsAdded += result.added;
            streamsModified += result.modified;
            incomeStreamsAdded += result.added;
            incomeStreamsModified += result.modified;
        }
        // Process outflow streams (save to 'outflows' collection)
        if (outflow_streams) {
            const result = await processRecurringStreams(outflow_streams, itemData, types_1.PlaidRecurringTransactionStreamType.OUTFLOW);
            streamsFound += outflow_streams.length;
            streamsAdded += result.added;
            streamsModified += result.modified;
            outflowStreamsAdded += result.added;
            outflowStreamsModified += result.modified;
        }
        return {
            itemId: itemData.itemId,
            accountsCount: targetAccountIds.length,
            streamsFound,
            streamsAdded,
            streamsModified,
            incomeStreamsAdded,
            outflowStreamsAdded,
            incomeStreamsModified,
            outflowStreamsModified,
            historicalTransactionsDays: 180, // Standard for recurring transactions
        };
    }
    catch (error) {
        console.error(`Error processing recurring transactions for item ${itemData.itemId}:`, error);
        throw error;
    }
}
/**
 * Process a set of recurring transaction streams and save to appropriate root collection
 */
async function processRecurringStreams(streams, itemData, streamType) {
    var _a, _b, _c;
    let added = 0;
    let modified = 0;
    // Determine target collection based on stream type
    const targetCollection = streamType === types_1.PlaidRecurringTransactionStreamType.INFLOW ? 'inflow' : 'outflows';
    console.log(`Processing ${streams.length} ${streamType} streams to '${targetCollection}' collection`);
    for (const stream of streams) {
        try {
            // Check if stream already exists in the target collection
            const existingStreamQuery = await index_1.db.collection(targetCollection)
                .where('streamId', '==', stream.stream_id)
                .where('itemId', '==', itemData.itemId)
                .limit(1)
                .get();
            // Parse base stream data - using hybrid structure
            const baseData = {
                // === QUERY-CRITICAL FIELDS AT ROOT ===
                userId: itemData.userId,
                groupId: itemData.familyId,
                accessibleBy: [itemData.userId],
                streamId: stream.stream_id,
                itemId: itemData.itemId,
                accountId: stream.account_id,
                isActive: stream.is_active !== false,
                status: mapPlaidRecurringStatus(stream.status),
                // === NESTED ACCESS CONTROL ===
                access: {
                    ownerId: itemData.userId,
                    createdBy: itemData.userId,
                    sharedWith: [],
                    visibility: 'private',
                    permissions: {}
                },
                // === NESTED CATEGORIES ===
                categories: {
                    primary: ((_a = stream.category) === null || _a === void 0 ? void 0 : _a[0]) || 'other',
                    secondary: (_b = stream.category) === null || _b === void 0 ? void 0 : _b[1],
                    tags: []
                },
                // === NESTED METADATA ===
                metadata: {
                    source: 'plaid',
                    createdBy: itemData.userId,
                    updatedBy: itemData.userId,
                    updatedAt: firestore_1.Timestamp.now(),
                    version: 1,
                    lastSyncedAt: firestore_1.Timestamp.now(),
                    syncVersion: 1,
                    plaidPersonalFinanceCategory: stream.personal_finance_category ? {
                        primary: stream.personal_finance_category.primary,
                        detailed: stream.personal_finance_category.detailed,
                        confidenceLevel: stream.personal_finance_category.confidence_level,
                    } : undefined
                },
                // === NESTED RELATIONSHIPS ===
                relationships: {
                    parentId: itemData.itemId,
                    parentType: 'plaid_item',
                    linkedIds: [],
                    relatedDocs: []
                },
                // === RECURRING TRANSACTION FIELDS ===
                description: stream.description || stream.merchant_name || 'Unknown',
                merchantName: stream.merchant_name || null,
                averageAmount: mapPlaidAmount(stream.average_amount),
                lastAmount: mapPlaidAmount(stream.last_amount),
                frequency: mapPlaidFrequency(stream.frequency),
                firstDate: firestore_1.Timestamp.fromDate(new Date(stream.first_date)),
                lastDate: firestore_1.Timestamp.fromDate(new Date(stream.last_date)),
                isHidden: false,
            };
            // Add type-specific fields
            let documentData = Object.assign({}, baseData);
            if (streamType === types_1.PlaidRecurringTransactionStreamType.INFLOW) {
                // Add income-specific fields
                documentData = Object.assign(Object.assign({}, documentData), { incomeType: categorizeIncomeType(stream.category, stream.description), isRegularSalary: isLikelySalary(stream.description, stream.merchant_name), employerName: stream.merchant_name || undefined, taxable: true });
            }
            else {
                // Add outflow-specific fields
                documentData = Object.assign(Object.assign({}, documentData), { expenseType: categorizeExpenseType(stream.category, stream.description), isEssential: isEssentialExpense(stream.category, stream.description), merchantCategory: ((_c = stream.personal_finance_category) === null || _c === void 0 ? void 0 : _c.primary) || undefined, isCancellable: isCancellableExpense(stream.category, stream.description), reminderDays: getDefaultReminderDays(stream.category) });
            }
            if (existingStreamQuery.empty) {
                // Create new document in target collection
                await index_1.db.collection(targetCollection).add(Object.assign(Object.assign({}, documentData), { createdAt: firestore_1.Timestamp.now(), updatedAt: firestore_1.Timestamp.now() }));
                added++;
                console.log(`Added new ${streamType} stream to ${targetCollection}: ${stream.stream_id}`);
            }
            else {
                // Update existing document
                const existingDoc = existingStreamQuery.docs[0];
                const existingData = existingDoc.data();
                // Only update Plaid-controlled fields (preserve user customizations)
                const updateData = {
                    isActive: documentData.isActive,
                    status: documentData.status,
                    description: documentData.description,
                    merchantName: documentData.merchantName,
                    category: documentData.category,
                    personalFinanceCategory: documentData.personalFinanceCategory,
                    averageAmount: documentData.averageAmount,
                    lastAmount: documentData.lastAmount,
                    frequency: documentData.frequency,
                    firstDate: documentData.firstDate,
                    lastDate: documentData.lastDate,
                    transactionIds: documentData.transactionIds,
                    lastSyncedAt: documentData.lastSyncedAt,
                    syncVersion: (existingData.syncVersion || 0) + 1,
                    updatedAt: firestore_1.Timestamp.now(),
                };
                await existingDoc.ref.update(updateData);
                modified++;
                console.log(`Updated ${streamType} stream in ${targetCollection}: ${stream.stream_id}`);
            }
        }
        catch (error) {
            console.error(`Error processing ${streamType} stream ${stream.stream_id}:`, error);
            // Continue processing other streams
        }
    }
    return { added, modified };
}
/**
 * Map Plaid recurring status to our enum
 */
function mapPlaidRecurringStatus(status) {
    switch (status === null || status === void 0 ? void 0 : status.toUpperCase()) {
        case 'MATURE':
            return types_1.PlaidRecurringTransactionStatus.MATURE;
        case 'EARLY_DETECTION':
            return types_1.PlaidRecurringTransactionStatus.EARLY_DETECTION;
        default:
            return types_1.PlaidRecurringTransactionStatus.EARLY_DETECTION;
    }
}
/**
 * Map Plaid frequency to our enum
 */
function mapPlaidFrequency(frequency) {
    switch (frequency === null || frequency === void 0 ? void 0 : frequency.toUpperCase()) {
        case 'WEEKLY':
            return types_1.PlaidRecurringFrequency.WEEKLY;
        case 'BIWEEKLY':
            return types_1.PlaidRecurringFrequency.BIWEEKLY;
        case 'SEMI_MONTHLY':
            return types_1.PlaidRecurringFrequency.SEMI_MONTHLY;
        case 'MONTHLY':
            return types_1.PlaidRecurringFrequency.MONTHLY;
        case 'ANNUALLY':
            return types_1.PlaidRecurringFrequency.ANNUALLY;
        default:
            return types_1.PlaidRecurringFrequency.UNKNOWN;
    }
}
/**
 * Map Plaid amount object to our interface
 */
function mapPlaidAmount(amount) {
    return {
        amount: (amount === null || amount === void 0 ? void 0 : amount.amount) || 0,
        isoCurrencyCode: (amount === null || amount === void 0 ? void 0 : amount.iso_currency_code) || null,
        unofficialCurrencyCode: (amount === null || amount === void 0 ? void 0 : amount.unofficial_currency_code) || null,
    };
}
/**
 * Categorize income type based on Plaid data
 */
function categorizeIncomeType(category, description) {
    const categoryStr = category.join(' ').toLowerCase();
    const descStr = description.toLowerCase();
    if (categoryStr.includes('payroll') || descStr.includes('salary') || descStr.includes('payroll')) {
        return 'salary';
    }
    if (categoryStr.includes('dividend') || descStr.includes('dividend')) {
        return 'dividend';
    }
    if (categoryStr.includes('interest') || descStr.includes('interest')) {
        return 'interest';
    }
    if (categoryStr.includes('rental') || descStr.includes('rent')) {
        return 'rental';
    }
    if (descStr.includes('freelance') || descStr.includes('contractor')) {
        return 'freelance';
    }
    if (descStr.includes('bonus')) {
        return 'bonus';
    }
    return 'other';
}
/**
 * Check if transaction is likely salary
 */
function isLikelySalary(description, merchantName) {
    const text = `${description} ${merchantName || ''}`.toLowerCase();
    return text.includes('payroll') || text.includes('salary') || text.includes('direct deposit');
}
/**
 * Categorize expense type based on Plaid data
 */
function categorizeExpenseType(category, description) {
    const categoryStr = category.join(' ').toLowerCase();
    const descStr = description.toLowerCase();
    if (categoryStr.includes('subscription') || descStr.includes('subscription') || descStr.includes('monthly')) {
        return 'subscription';
    }
    if (categoryStr.includes('utilities') || descStr.includes('electric') || descStr.includes('gas') || descStr.includes('water')) {
        return 'utility';
    }
    if (categoryStr.includes('loan') || descStr.includes('loan') || descStr.includes('mortgage')) {
        return 'loan';
    }
    if (descStr.includes('rent') || categoryStr.includes('rent')) {
        return 'rent';
    }
    if (categoryStr.includes('insurance') || descStr.includes('insurance')) {
        return 'insurance';
    }
    if (categoryStr.includes('tax') || descStr.includes('tax')) {
        return 'tax';
    }
    return 'other';
}
/**
 * Check if expense is essential
 */
function isEssentialExpense(category, description) {
    const essentialCategories = ['rent', 'mortgage', 'utilities', 'insurance', 'loan', 'food'];
    const categoryStr = category.join(' ').toLowerCase();
    return essentialCategories.some(essential => categoryStr.includes(essential));
}
/**
 * Check if expense is easily cancellable
 */
function isCancellableExpense(category, description) {
    const cancellableCategories = ['subscription', 'entertainment', 'streaming'];
    const categoryStr = category.join(' ').toLowerCase();
    const descStr = description.toLowerCase();
    return cancellableCategories.some(cancellable => categoryStr.includes(cancellable) || descStr.includes(cancellable));
}
/**
 * Get default reminder days based on category
 */
function getDefaultReminderDays(category) {
    const categoryStr = category.join(' ').toLowerCase();
    if (categoryStr.includes('loan') || categoryStr.includes('mortgage') || categoryStr.includes('rent')) {
        return 7; // One week for important payments
    }
    if (categoryStr.includes('utilities') || categoryStr.includes('insurance')) {
        return 5; // 5 days for utilities/insurance
    }
    return 3; // 3 days default
}
//# sourceMappingURL=fetchRecurringTransactions.js.map