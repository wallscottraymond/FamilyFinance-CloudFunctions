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
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTransactionData = buildTransactionData;
const firestore_1 = require("firebase-admin/firestore");
const index_1 = require("../../../index");
const types_1 = require("../../../types");
/**
 * Build transaction data from Plaid transaction
 *
 * UPDATED: Creates flat transaction structure with all fields at root level.
 *
 * @param plaidTransaction - Raw transaction data from Plaid
 * @param plaidAccount - Account information
 * @param userId - User ID
 * @param groupId - Group ID (null for private transactions)
 * @param currency - Currency code
 * @param itemId - Plaid item ID
 * @returns Formatted transaction ready for Firestore, or null if formatting fails
 */
async function buildTransactionData(plaidTransaction, plaidAccount, userId, groupId, currency, itemId) {
    var _a, _b;
    try {
        // Determine transaction type and amount
        const transactionType = plaidTransaction.amount > 0 ? types_1.TransactionType.EXPENSE : types_1.TransactionType.INCOME;
        const absoluteAmount = Math.abs(plaidTransaction.amount);
        // Transaction date for payment tracking
        const transactionDate = plaidTransaction.date
            ? firestore_1.Timestamp.fromDate(new Date(plaidTransaction.date))
            : firestore_1.Timestamp.now();
        // Extract primary and detailed categories from Plaid
        const categoryPrimary = ((_a = plaidTransaction.personal_finance_category) === null || _a === void 0 ? void 0 : _a.primary) || 'OTHER_EXPENSE';
        const categoryDetailed = ((_b = plaidTransaction.personal_finance_category) === null || _b === void 0 ? void 0 : _b.detailed) || 'OTHER_EXPENSE';
        console.log(`🏷️ Plaid categories for transaction ${plaidTransaction.transaction_id}: primary=${categoryPrimary}, detailed=${categoryDetailed}`);
        // Create default split for the transaction with NEW FLAT STRUCTURE
        const defaultSplit = {
            splitId: index_1.db.collection('_dummy').doc().id,
            budgetId: 'unassigned', // Will be updated by matchTransactionSplitsToBudgets
            amount: absoluteAmount,
            description: null,
            isDefault: true,
            // Source period IDs - will be populated by matchTransactionSplitsToSourcePeriods
            monthlyPeriodId: null,
            weeklyPeriodId: null,
            biWeeklyPeriodId: null,
            // Assignment references - will be populated by matchTransactionSplitsToOutflows
            outflowId: undefined,
            // Category fields with NEW NAMING
            plaidPrimaryCategory: categoryPrimary,
            plaidDetailedCategory: categoryDetailed,
            internalPrimaryCategory: null, // User override (initially null)
            internalDetailedCategory: null, // User override (initially null)
            // Enhanced status fields
            isIgnored: false,
            isRefund: false,
            isTaxDeductible: false,
            ignoredReason: null,
            refundReason: null,
            // Payment tracking
            paymentDate: transactionDate,
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
            transactionId: plaidTransaction.transaction_id,
            ownerId: userId,
            groupId: groupId || null,
            transactionDate,
            accountId: plaidTransaction.account_id,
            createdBy: userId,
            updatedBy: userId,
            currency,
            description: plaidTransaction.merchant_name || plaidTransaction.name || 'Bank Transaction',
            // === CATEGORY FIELDS (flattened to root) ===
            internalDetailedCategory: null, // User override (initially null)
            internalPrimaryCategory: null, // User override (initially null)
            plaidDetailedCategory: categoryDetailed,
            plaidPrimaryCategory: categoryPrimary,
            // === PLAID METADATA (flattened to root) ===
            plaidItemId: itemId,
            source: 'plaid',
            transactionStatus: plaidTransaction.pending ? types_1.TransactionStatus.PENDING : types_1.TransactionStatus.APPROVED,
            // === TYPE AND IDENTIFIERS ===
            type: transactionType,
            name: plaidTransaction.name,
            merchantName: plaidTransaction.merchant_name || null,
            // === SPLITS ARRAY ===
            splits: [defaultSplit],
            // === INITIAL PLAID DATA (preserved for reference) ===
            initialPlaidData: {
                plaidAccountId: plaidTransaction.account_id,
                plaidMerchantName: plaidTransaction.merchant_name || '',
                plaidName: plaidTransaction.name,
                plaidTransactionId: plaidTransaction.transaction_id,
                plaidPending: plaidTransaction.pending,
                source: 'plaid',
            },
        };
        console.log(`✅ [buildTransactionData] Transaction mapped from Plaid (flat structure):`, {
            transactionId: plaidTransaction.transaction_id,
            ownerId: userId,
            groupId: groupId || null,
            note: 'Period IDs and budget assignments will be populated by matching functions'
        });
        return transaction;
    }
    catch (error) {
        console.error('Error formatting transaction from Plaid data:', {
            error: error instanceof Error ? error.message : error,
            stack: error instanceof Error ? error.stack : undefined,
            transactionId: plaidTransaction.transaction_id,
            userId,
            groupId
        });
        return null;
    }
}
//# sourceMappingURL=buildTransactionData.js.map