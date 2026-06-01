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

import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../../index';
import {
  Transaction as FamilyTransaction,
  TransactionSplit,
  TransactionStatus,
  TransactionType,
  PlaidAccount
} from '../../../types';

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
export async function build_transaction_data(
  plaid_transaction: any,
  plaid_account: PlaidAccount,
  user_id: string,
  group_id: string | undefined,
  currency: string,
  item_id: string
): Promise<FamilyTransaction | null> {
  try {
    // Determine transaction type and amount
    const transaction_type = plaid_transaction.amount > 0 ? TransactionType.EXPENSE : TransactionType.INCOME;
    const absolute_amount = Math.abs(plaid_transaction.amount);

    // Transaction date for payment tracking
    const transaction_date = plaid_transaction.date
      ? Timestamp.fromDate(new Date(plaid_transaction.date))
      : Timestamp.now();

    // Extract primary and detailed categories from Plaid
    const category_primary = plaid_transaction.personal_finance_category?.primary || 'OTHER_EXPENSE';
    const category_detailed = plaid_transaction.personal_finance_category?.detailed || 'OTHER_EXPENSE';

    console.log(`🏷️ Plaid categories for transaction ${plaid_transaction.transaction_id}: primary=${category_primary}, detailed=${category_detailed}`);

    // Create default split for the transaction with NEW FLAT STRUCTURE
    const default_split: TransactionSplit = {
      splitId: db.collection('_dummy').doc().id,
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
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    // Build NEW FLAT transaction structure
    const transaction: Omit<FamilyTransaction, "id" | "createdAt" | "updatedAt"> = {
      // === ROOT-LEVEL QUERY FIELDS ===
      transactionId: plaid_transaction.transaction_id,
      userId: user_id,  // For backward compatibility with queries
      ownerId: user_id,  // RBAC owner field
      groupId: group_id || null,
      transactionDate: transaction_date,
      accountId: plaid_transaction.account_id,
      createdBy: user_id,
      updatedBy: user_id,
      currency,
      description: plaid_transaction.merchant_name || plaid_transaction.name || 'Bank Transaction',

      // === CATEGORY FIELDS (flattened to root) ===
      internalDetailedCategory: null, // User override (initially null)
      internalPrimaryCategory: null,  // User override (initially null)
      plaidDetailedCategory: category_detailed,
      plaidPrimaryCategory: category_primary,

      // === PLAID METADATA (flattened to root) ===
      plaidItemId: item_id,
      source: 'plaid' as const,
      transactionStatus: plaid_transaction.pending ? TransactionStatus.PENDING : TransactionStatus.APPROVED,

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
        source: 'plaid' as const,
      },
    };

    console.log(`✅ [build_transaction_data] Transaction mapped from Plaid (flat structure):`, {
      transactionId: plaid_transaction.transaction_id,
      ownerId: user_id,
      groupId: group_id || null,
      note: 'Period IDs and budget assignments will be populated by matching functions'
    });

    return transaction as FamilyTransaction;

  } catch (error) {
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

// Legacy export for backward compatibility
export { build_transaction_data as buildTransactionData };
