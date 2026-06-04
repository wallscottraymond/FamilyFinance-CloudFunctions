"use strict";
/**
 * Legacy Transaction Transformer
 *
 * PURE transformer functions to convert legacy FamilyTransaction
 * (camelCase) to TransactionForPersistence (snake_case).
 *
 * This bridges the existing 6-step pipeline output with the
 * new architecture-compliant repository layer.
 *
 * @module integrations/plaid/legacy_transaction_transformer
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.transform_legacy_to_persistence = transform_legacy_to_persistence;
const types_1 = require("../../../types");
/**
 * Transforms legacy FamilyTransaction array to TransactionForPersistence array.
 *
 * PURE FUNCTION - no IO, no side effects, deterministic.
 *
 * @param transactions - Legacy transactions from the 6-step pipeline
 * @param user_id - User ID for ownership
 * @param group_ids - Group IDs for access control
 * @returns Array of transactions ready for the new repository
 */
function transform_legacy_to_persistence(transactions, user_id, group_ids) {
    return transactions.map(txn => transform_single_legacy_transaction(txn, user_id, group_ids));
}
/**
 * Transforms a single legacy transaction to persistence format.
 */
function transform_single_legacy_transaction(txn, user_id, group_ids) {
    var _a, _b, _c, _d, _e, _f;
    // Calculate total amount from splits (more accurate than any root-level amount)
    const total_amount = txn.splits.reduce((sum, s) => sum + s.amount, 0);
    // Determine if pending from status
    const is_pending = txn.transactionStatus === types_1.TransactionStatus.PENDING ||
        ((_a = txn.initialPlaidData) === null || _a === void 0 ? void 0 : _a.plaidPending) === true;
    return {
        // Use existing ID if available, otherwise use transactionId
        id: txn.id || undefined,
        transaction_id: txn.transactionId,
        user_id: user_id,
        group_ids: group_ids,
        is_active: true,
        // Plaid identifiers
        plaid_item_id: txn.plaidItemId,
        account_id: txn.accountId,
        // Financial data
        amount: total_amount,
        currency: txn.currency,
        transaction_date: timestamp_to_date(txn.transactionDate),
        // Description
        name: txn.name,
        merchant_name: txn.merchantName,
        // Status
        is_pending: is_pending,
        pending_transaction_id: null, // Set separately for migrations
        // Type
        type: map_transaction_type(txn.type),
        source: "plaid", // Always "plaid" for Plaid sync pipeline
        // Categories
        plaid_primary_category: txn.plaidPrimaryCategory,
        plaid_detailed_category: txn.plaidDetailedCategory,
        internal_primary_category: txn.internalPrimaryCategory,
        internal_detailed_category: txn.internalDetailedCategory,
        // Splits
        splits: txn.splits.map(transform_legacy_split),
        // Initial Plaid data preservation
        initial_plaid_data: {
            plaid_account_id: ((_b = txn.initialPlaidData) === null || _b === void 0 ? void 0 : _b.plaidAccountId) || txn.accountId,
            plaid_merchant_name: ((_c = txn.initialPlaidData) === null || _c === void 0 ? void 0 : _c.plaidMerchantName) || txn.merchantName,
            plaid_name: ((_d = txn.initialPlaidData) === null || _d === void 0 ? void 0 : _d.plaidName) || txn.name,
            plaid_transaction_id: ((_e = txn.initialPlaidData) === null || _e === void 0 ? void 0 : _e.plaidTransactionId) || txn.transactionId,
            plaid_pending: ((_f = txn.initialPlaidData) === null || _f === void 0 ? void 0 : _f.plaidPending) || is_pending,
        },
    };
}
/**
 * Transforms a legacy split to persistence format.
 */
function transform_legacy_split(split) {
    return {
        split_id: split.splitId,
        amount: split.amount,
        budget_id: split.budgetId,
        outflow_id: split.outflowId || null,
        // Period IDs
        monthly_period_id: split.monthlyPeriodId,
        weekly_period_id: split.weeklyPeriodId,
        bi_weekly_period_id: split.biWeeklyPeriodId,
        // Categories
        plaid_primary_category: split.plaidPrimaryCategory,
        plaid_detailed_category: split.plaidDetailedCategory,
        internal_primary_category: split.internalPrimaryCategory,
        internal_detailed_category: split.internalDetailedCategory,
        // Status flags
        is_default: split.isDefault,
        is_ignored: split.isIgnored || false,
        is_refund: split.isRefund || false,
        is_tax_deductible: split.isTaxDeductible || false,
        // Payment date
        payment_date: timestamp_to_date(split.paymentDate),
        // Metadata
        tags: split.tags || [],
        rules: split.rules || [],
    };
}
/**
 * Converts Firestore Timestamp to Date.
 * Handles both Timestamp objects and Date objects.
 */
function timestamp_to_date(timestamp) {
    if (!timestamp) {
        return new Date();
    }
    if (timestamp instanceof Date) {
        return timestamp;
    }
    if (typeof timestamp.toDate === "function") {
        return timestamp.toDate();
    }
    // Fallback for unexpected types
    return new Date();
}
/**
 * Maps legacy TransactionType enum to new string literal type.
 */
function map_transaction_type(type) {
    if (!type)
        return "expense";
    switch (type) {
        case types_1.TransactionType.INCOME:
            return "income";
        case types_1.TransactionType.EXPENSE:
            return "expense";
        case types_1.TransactionType.TRANSFER:
            return "transfer";
        default:
            return "expense";
    }
}
//# sourceMappingURL=legacy_transaction_transformer.js.map