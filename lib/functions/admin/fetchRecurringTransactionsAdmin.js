"use strict";
/**
 * Admin Fetch Recurring Transactions Function
 *
 * Administrative function to fetch recurring transactions for all users or specific user.
 * This bypasses normal authentication for initial setup or troubleshooting.
 *
 * SECURITY WARNING: This function should only be used for admin setup and testing.
 * Remove or secure before production deployment.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchRecurringTransactionsAdmin = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const cors_1 = require("../../middleware/cors");
const index_1 = require("../../index");
const plaid_1 = require("plaid");
const types_1 = require("../../types");
const firestore_1 = require("firebase-admin/firestore");
// Define secrets for Plaid configuration
const plaidClientId = (0, params_1.defineSecret)('PLAID_CLIENT_ID');
const plaidSecret = (0, params_1.defineSecret)('PLAID_SECRET');
// Configure Plaid client
let plaidClient = null;
function getPlaidClient() {
    if (!plaidClient) {
        console.log('Creating Plaid client for sandbox environment');
        const configuration = new plaid_1.Configuration({
            basePath: plaid_1.PlaidEnvironments.sandbox,
        });
        plaidClient = new plaid_1.PlaidApi(configuration);
    }
    return plaidClient;
}
/**
 * Admin Fetch Recurring Transactions
 * Processes all users with Plaid items to populate outflows and inflow collections
 */
exports.fetchRecurringTransactionsAdmin = (0, https_1.onRequest)({
    memory: '1GiB',
    timeoutSeconds: 300,
    cors: true,
    secrets: [plaidClientId, plaidSecret],
}, async (req, res) => {
    return new Promise(async (resolve) => {
        try {
            // Apply CORS middleware
            (0, cors_1.corsMiddleware)(req, res, async () => {
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
                    console.log('Starting admin fetch of recurring transactions for all users');
                    // Get all active Plaid items across all users
                    const allUsersSnapshot = await index_1.db.collection('users').get();
                    let totalUsersProcessed = 0;
                    let totalItemsProcessed = 0;
                    let totalOutflowsCreated = 0;
                    let totalIncomeCreated = 0;
                    const userSummary = [];
                    for (const userDoc of allUsersSnapshot.docs) {
                        const userData = userDoc.data();
                        const userId = userDoc.id;
                        console.log(`Processing user: ${userData.email || userId}`);
                        // Get user's Plaid items
                        const itemsSnapshot = await index_1.db.collection('users')
                            .doc(userId)
                            .collection('plaidItems')
                            .where('isActive', '==', true)
                            .get();
                        if (itemsSnapshot.empty) {
                            console.log(`  No active Plaid items for user ${userId}`);
                            continue;
                        }
                        let userOutflows = 0;
                        let userIncome = 0;
                        let userItems = 0;
                        // Process each item for this user
                        for (const itemDoc of itemsSnapshot.docs) {
                            const itemData = itemDoc.data();
                            try {
                                console.log(`  Processing item: ${itemData.itemId} (${itemData.institutionName})`);
                                const result = await processItemRecurringTransactionsAdmin(itemData);
                                userOutflows += result.outflowStreamsAdded;
                                userIncome += result.incomeStreamsAdded;
                                userItems++;
                                totalItemsProcessed++;
                            }
                            catch (error) {
                                console.error(`  Error processing item ${itemData.itemId}:`, error);
                                // Continue processing other items
                            }
                        }
                        if (userItems > 0) {
                            totalUsersProcessed++;
                            totalOutflowsCreated += userOutflows;
                            totalIncomeCreated += userIncome;
                            userSummary.push({
                                userId,
                                email: userData.email || 'No email',
                                outflows: userOutflows,
                                income: userIncome,
                                items: userItems,
                            });
                            console.log(`  User ${userData.email} summary: ${userOutflows} outflows, ${userIncome} income, ${userItems} items`);
                        }
                    }
                    res.status(200).json({
                        success: true,
                        data: {
                            totalUsersProcessed,
                            totalItemsProcessed,
                            totalOutflows: totalOutflowsCreated,
                            totalIncome: totalIncomeCreated,
                            summary: userSummary,
                        },
                        message: `Admin fetch completed: Processed ${totalUsersProcessed} users, ${totalItemsProcessed} items`,
                    });
                    console.log(`Admin recurring transactions fetch completed successfully`, {
                        totalUsersProcessed,
                        totalItemsProcessed,
                        totalOutflowsCreated,
                        totalIncomeCreated,
                    });
                    resolve();
                }
                catch (error) {
                    console.error('Error in admin fetch recurring transactions:', error);
                    // Handle general errors
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                    res.status(500).json({
                        success: false,
                        error: {
                            code: 'INTERNAL_ERROR',
                            message: errorMessage,
                        },
                    });
                    resolve();
                }
            });
        }
        catch (error) {
            console.error('Unhandled error in fetchRecurringTransactionsAdmin:', error);
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
 * Admin version of processItemRecurringTransactions
 */
async function processItemRecurringTransactionsAdmin(itemData) {
    try {
        console.log(`    Processing recurring transactions for item: ${itemData.itemId}`);
        // Get accounts for this item to pass to Plaid API
        const accountsSnapshot = await index_1.db.collection('accounts')
            .where('itemId', '==', itemData.itemId)
            .where('isActive', '==', true)
            .get();
        const allAccountIds = accountsSnapshot.docs.map(doc => doc.data().plaidAccountId || doc.data().accountId);
        console.log(`    Found ${allAccountIds.length} active accounts for item ${itemData.itemId}:`, allAccountIds);
        if (allAccountIds.length === 0) {
            console.warn(`    No active accounts found for item ${itemData.itemId}`);
            return {
                itemId: itemData.itemId,
                streamsFound: 0,
                streamsAdded: 0,
                streamsModified: 0,
                incomeStreamsAdded: 0,
                outflowStreamsAdded: 0,
            };
        }
        console.log(`    Using account IDs for Plaid API:`, allAccountIds);
        // Prepare Plaid API request
        const request = {
            client_id: plaidClientId.value(),
            secret: plaidSecret.value(),
            access_token: itemData.accessToken, // TODO: Decrypt this in production
            account_ids: allAccountIds, // Use specific account IDs instead of empty array
        };
        console.log(`    Calling Plaid transactionsRecurringGet with account IDs:`, request.account_ids);
        const client = getPlaidClient();
        const response = await client.transactionsRecurringGet(request);
        if (!response.data) {
            throw new Error('No data returned from Plaid recurring transactions API');
        }
        const { inflow_streams, outflow_streams } = response.data;
        console.log(`    Retrieved recurring transactions from Plaid`, {
            itemId: itemData.itemId,
            inflowStreams: (inflow_streams === null || inflow_streams === void 0 ? void 0 : inflow_streams.length) || 0,
            outflowStreams: (outflow_streams === null || outflow_streams === void 0 ? void 0 : outflow_streams.length) || 0,
        });
        let streamsFound = 0;
        let streamsAdded = 0;
        let streamsModified = 0;
        let incomeStreamsAdded = 0;
        let outflowStreamsAdded = 0;
        // Process inflow streams (save to 'inflow' collection)
        if (inflow_streams) {
            const result = await processRecurringStreamsAdmin(inflow_streams, itemData, types_1.PlaidRecurringTransactionStreamType.INFLOW);
            streamsFound += inflow_streams.length;
            streamsAdded += result.added;
            streamsModified += result.modified;
            incomeStreamsAdded += result.added;
        }
        // Process outflow streams (save to 'outflows' collection)
        if (outflow_streams) {
            const result = await processRecurringStreamsAdmin(outflow_streams, itemData, types_1.PlaidRecurringTransactionStreamType.OUTFLOW);
            streamsFound += outflow_streams.length;
            streamsAdded += result.added;
            streamsModified += result.modified;
            outflowStreamsAdded += result.added;
        }
        return {
            itemId: itemData.itemId,
            streamsFound,
            streamsAdded,
            streamsModified,
            incomeStreamsAdded,
            outflowStreamsAdded,
        };
    }
    catch (error) {
        console.error(`    Error processing recurring transactions for item ${itemData.itemId}:`, error);
        throw error;
    }
}
/**
 * Admin version of processRecurringStreams
 */
async function processRecurringStreamsAdmin(streams, itemData, streamType) {
    var _a, _b, _c, _d;
    let added = 0;
    let modified = 0;
    // Determine target collection based on stream type
    const targetCollection = streamType === types_1.PlaidRecurringTransactionStreamType.INFLOW ? 'inflow' : 'outflows';
    console.log(`    Processing ${streams.length} ${streamType} streams to '${targetCollection}' collection`);
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
                console.log(`      Added new ${streamType} stream to ${targetCollection}: ${stream.stream_id}`);
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
                    categories: documentData.categories,
                    'metadata.plaidPersonalFinanceCategory': documentData.metadata.plaidPersonalFinanceCategory,
                    averageAmount: documentData.averageAmount,
                    lastAmount: documentData.lastAmount,
                    frequency: documentData.frequency,
                    firstDate: documentData.firstDate,
                    lastDate: documentData.lastDate,
                    'metadata.lastSyncedAt': documentData.metadata.lastSyncedAt,
                    'metadata.syncVersion': (((_d = existingData.metadata) === null || _d === void 0 ? void 0 : _d.syncVersion) || 0) + 1,
                    'metadata.updatedAt': firestore_1.Timestamp.now(),
                    updatedAt: firestore_1.Timestamp.now(),
                };
                await existingDoc.ref.update(updateData);
                modified++;
                console.log(`      Updated ${streamType} stream in ${targetCollection}: ${stream.stream_id}`);
            }
        }
        catch (error) {
            console.error(`      Error processing ${streamType} stream ${stream.stream_id}:`, error);
            // Continue processing other streams
        }
    }
    return { added, modified };
}
// Utility functions (copied from original file)
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
function mapPlaidAmount(amount) {
    return {
        amount: (amount === null || amount === void 0 ? void 0 : amount.amount) || 0,
        isoCurrencyCode: (amount === null || amount === void 0 ? void 0 : amount.iso_currency_code) || null,
        unofficialCurrencyCode: (amount === null || amount === void 0 ? void 0 : amount.unofficial_currency_code) || null,
    };
}
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
function isLikelySalary(description, merchantName) {
    const text = `${description} ${merchantName || ''}`.toLowerCase();
    return text.includes('payroll') || text.includes('salary') || text.includes('direct deposit');
}
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
function isEssentialExpense(category, description) {
    const essentialCategories = ['rent', 'mortgage', 'utilities', 'insurance', 'loan', 'food'];
    const categoryStr = category.join(' ').toLowerCase();
    return essentialCategories.some(essential => categoryStr.includes(essential));
}
function isCancellableExpense(category, description) {
    const cancellableCategories = ['subscription', 'entertainment', 'streaming'];
    const categoryStr = category.join(' ').toLowerCase();
    const descStr = description.toLowerCase();
    return cancellableCategories.some(cancellable => categoryStr.includes(cancellable) || descStr.includes(cancellable));
}
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
//# sourceMappingURL=fetchRecurringTransactionsAdmin.js.map