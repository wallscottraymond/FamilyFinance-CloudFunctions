"use strict";
/**
 * Transaction Data Builder
 *
 * Transforms raw Plaid transaction data into flat application transaction format.
 * UPDATED: New flat structure without nested access/categories/metadata/relationships objects.
 *
 * Responsibilities:
 * - Plaid data extraction and mapping
 * - Category determination
 * - Transaction split creation with flat structure
 * - Transaction structure building with all fields at root level
 *
 * @module transactions/utils/build_transaction_data
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.build_transaction_data = build_transaction_data;
exports.buildTransactionData = build_transaction_data;
const firestore_1 = require("firebase-admin/firestore");
const index_1 = require("../../../index");
const types_1 = require("../../../types");
/**
 * Build transaction data from Plaid transaction
 *
 * UPDATED: Creates flat transaction structure with all fields at root level.
 *
 * @param plaid_transaction - Raw transaction data from Plaid
 * @param plaid_account - Account information
 * @param user_id - User ID
 * @param group_id - Group ID (null for private transactions)
 * @param currency - Currency code
 * @param item_id - Plaid item ID
 * @returns Formatted transaction ready for Firestore, or null if formatting fails
 */
async function build_transaction_data(plaid_transaction, plaid_account, user_id, group_id, currency, item_id) {
    var _a, _b;
    try {
        // Determine transaction type and amount
        const transaction_type = plaid_transaction.amount > 0 ? types_1.TransactionType.EXPENSE : types_1.TransactionType.INCOME;
        const absolute_amount = Math.abs(plaid_transaction.amount);
        // Transaction date for payment tracking
        const transaction_date = plaid_transaction.date
            ? firestore_1.Timestamp.fromDate(new Date(plaid_transaction.date))
            : firestore_1.Timestamp.now();
        // Extract primary and detailed categories from Plaid
        const category_primary = ((_a = plaid_transaction.personal_finance_category) === null || _a === void 0 ? void 0 : _a.primary) || 'OTHER_EXPENSE';
        const category_detailed = ((_b = plaid_transaction.personal_finance_category) === null || _b === void 0 ? void 0 : _b.detailed) || 'OTHER_EXPENSE';
        console.log(`🏷️ Plaid categories for transaction ${plaid_transaction.transaction_id}: primary=${category_primary}, detailed=${category_detailed}`);
        // Create default split for the transaction with NEW FLAT STRUCTURE
        const default_split = {
            splitId: index_1.db.collection('_dummy').doc().id,
            budgetId: 'unassigned', // Will be updated by match_transaction_splits_to_budgets
            amount: absolute_amount,
            description: null,
            isDefault: true,
            // Source period IDs - will be populated by match_transaction_splits_to_source_periods
            monthlyPeriodId: null,
            weeklyPeriodId: null,
            biWeeklyPeriodId: null,
            // Assignment references - will be populated by match_transaction_splits_to_outflows
            outflowId: undefined,
            // Category fields with NEW NAMING
            plaidPrimaryCategory: category_primary,
            plaidDetailedCategory: category_detailed,
            internalPrimaryCategory: null, // User override (initially null)
            internalDetailedCategory: null, // User override (initially null)
            // Enhanced status fields
            isIgnored: false,
            isRefund: false,
            isTaxDeductible: false,
            ignoredReason: null,
            refundReason: null,
            // Payment tracking
            paymentDate: transaction_date,
            // New array fields
            rules: [],
            tags: [],
            // Audit fields
            createdAt: firestore_1.Timestamp.now(),
            updatedAt: firestore_1.Timestamp.now(),
        };
        // Build NEW FLAT transaction structure
        const transaction = {
            // === ROOT-LEVEL QUERY FIELDS ===
            transactionId: plaid_transaction.transaction_id,
            userId: user_id, // For backward compatibility with queries
            ownerId: user_id, // RBAC owner field
            groupId: group_id || null,
            transactionDate: transaction_date,
            accountId: plaid_transaction.account_id,
            createdBy: user_id,
            updatedBy: user_id,
            currency,
            description: plaid_transaction.merchant_name || plaid_transaction.name || 'Bank Transaction',
            // === CATEGORY FIELDS (flattened to root) ===
            internalDetailedCategory: null, // User override (initially null)
            internalPrimaryCategory: null, // User override (initially null)
            plaidDetailedCategory: category_detailed,
            plaidPrimaryCategory: category_primary,
            // === PLAID METADATA (flattened to root) ===
            plaidItemId: item_id,
            source: 'plaid',
            transactionStatus: plaid_transaction.pending ? types_1.TransactionStatus.PENDING : types_1.TransactionStatus.APPROVED,
            // === TYPE AND IDENTIFIERS ===
            type: transaction_type,
            name: plaid_transaction.name,
            merchantName: plaid_transaction.merchant_name || null,
            // === SPLITS ARRAY ===
            splits: [default_split],
            // === INITIAL PLAID DATA (preserved for reference) ===
            initialPlaidData: {
                plaidAccountId: plaid_transaction.account_id,
                plaidMerchantName: plaid_transaction.merchant_name || '',
                plaidName: plaid_transaction.name,
                plaidTransactionId: plaid_transaction.transaction_id,
                plaidPending: plaid_transaction.pending,
                source: 'plaid',
            },
        };
        console.log(`✅ [build_transaction_data] Transaction mapped from Plaid (flat structure):`, {
            transactionId: plaid_transaction.transaction_id,
            ownerId: user_id,
            groupId: group_id || null,
            note: 'Period IDs and budget assignments will be populated by matching functions'
        });
        return transaction;
    }
    catch (error) {
        console.error('Error formatting transaction from Plaid data:', {
            error: error instanceof Error ? error.message : error,
            stack: error instanceof Error ? error.stack : undefined,
            transactionId: plaid_transaction.transaction_id,
            userId: user_id,
            groupId: group_id
        });
        return null;
    }
}
//# sourceMappingURL=build_transaction_data.js.map