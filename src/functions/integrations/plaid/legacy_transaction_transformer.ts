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

import { Timestamp } from "firebase-admin/firestore";
import {
  Transaction as FamilyTransaction,
  TransactionSplit,
  TransactionType,
  TransactionStatus,
} from "../../../types";
import {
  TransactionForPersistence,
  TransactionSplitForPersistence,
} from "../../types/plaid";

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
export function transform_legacy_to_persistence(
  transactions: FamilyTransaction[],
  user_id: string,
  group_ids: string[]
): TransactionForPersistence[] {
  return transactions.map(txn =>
    transform_single_legacy_transaction(txn, user_id, group_ids)
  );
}

/**
 * Transforms a single legacy transaction to persistence format.
 */
function transform_single_legacy_transaction(
  txn: FamilyTransaction,
  user_id: string,
  group_ids: string[]
): TransactionForPersistence {
  // Calculate total amount from splits (more accurate than any root-level amount)
  const total_amount = txn.splits.reduce((sum, s) => sum + s.amount, 0);

  // Determine if pending from status
  const is_pending = txn.transactionStatus === TransactionStatus.PENDING ||
                     txn.initialPlaidData?.plaidPending === true;

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
      plaid_account_id: txn.initialPlaidData?.plaidAccountId || txn.accountId,
      plaid_merchant_name: txn.initialPlaidData?.plaidMerchantName || txn.merchantName,
      plaid_name: txn.initialPlaidData?.plaidName || txn.name,
      plaid_transaction_id: txn.initialPlaidData?.plaidTransactionId || txn.transactionId,
      plaid_pending: txn.initialPlaidData?.plaidPending || is_pending,
    },
  };
}

/**
 * Transforms a legacy split to persistence format.
 */
function transform_legacy_split(
  split: TransactionSplit
): TransactionSplitForPersistence {
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
function timestamp_to_date(timestamp: Timestamp | Date | undefined): Date {
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
function map_transaction_type(
  type: TransactionType | null | undefined
): "income" | "expense" | "transfer" {
  if (!type) return "expense";

  switch (type) {
    case TransactionType.INCOME:
      return "income";
    case TransactionType.EXPENSE:
      return "expense";
    case TransactionType.TRANSFER:
      return "transfer";
    default:
      return "expense";
  }
}
