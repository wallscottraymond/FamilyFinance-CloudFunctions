/**
 * Transaction Sync Domain Service
 *
 * Pure business logic for transaction synchronization.
 * NO async, NO IO, NO side effects.
 *
 * @module domain/plaid/transaction_sync
 */

import {
  TransactionForPersistence,
  TransactionSplitForPersistence,
  MaterialChangeResult,
  MaterialChangeField,
  PendingMigration,
  TransactionValidationResult,
  TransactionValidationError,
  TransactionSplitForMigration,
  MATERIAL_AMOUNT_CHANGE_THRESHOLD,
} from "../../types/plaid";

// ============================================================================
// Validation Functions (PURE)
// ============================================================================

/**
 * Validates transactions before sync persistence.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param transactions - Transactions to validate
 * @returns Validation result with valid transactions and errors
 */
export function validate_transactions_for_sync(
  transactions: TransactionForPersistence[]
): TransactionValidationResult {
  const valid_transactions: TransactionForPersistence[] = [];
  const validation_errors: TransactionValidationError[] = [];

  for (const txn of transactions) {
    const errors = validate_single_transaction(txn);

    if (errors.length === 0) {
      valid_transactions.push(txn);
    } else {
      validation_errors.push(...errors);
    }
  }

  return { valid_transactions, validation_errors };
}

/**
 * Validates a single transaction.
 *
 * PURE FUNCTION.
 */
function validate_single_transaction(
  txn: TransactionForPersistence
): TransactionValidationError[] {
  const errors: TransactionValidationError[] = [];

  if (!txn.transaction_id) {
    errors.push({
      plaid_transaction_id: txn.transaction_id || "unknown",
      field: "transaction_id",
      error: "Transaction ID is required",
    });
  }

  if (!txn.account_id) {
    errors.push({
      plaid_transaction_id: txn.transaction_id,
      field: "account_id",
      error: "Account ID is required",
    });
  }

  if (!txn.user_id) {
    errors.push({
      plaid_transaction_id: txn.transaction_id,
      field: "user_id",
      error: "User ID is required",
    });
  }

  if (txn.amount < 0) {
    errors.push({
      plaid_transaction_id: txn.transaction_id,
      field: "amount",
      error: "Amount must be non-negative (already normalized from Plaid)",
    });
  }

  if (!txn.splits || txn.splits.length === 0) {
    errors.push({
      plaid_transaction_id: txn.transaction_id,
      field: "splits",
      error: "Transaction must have at least one split",
    });
  }

  // Validate splits sum to transaction amount
  if (txn.splits && txn.splits.length > 0) {
    const splits_total = txn.splits.reduce((sum, s) => sum + s.amount, 0);
    if (Math.abs(splits_total - txn.amount) > 0.01) {
      errors.push({
        plaid_transaction_id: txn.transaction_id,
        field: "splits",
        error: `Splits total (${splits_total}) does not match transaction amount (${txn.amount})`,
      });
    }
  }

  return errors;
}

// ============================================================================
// Material Change Detection (PURE)
// ============================================================================

/**
 * Detects material changes between existing and new transaction data.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param existing - Current transaction data
 * @param new_data - New data from Plaid
 * @returns Material change result
 */
export function detect_material_changes(
  existing: {
    amount: number;
    transaction_date: Date;
    is_pending: boolean;
    plaid_primary_category: string;
    plaid_detailed_category: string;
  },
  new_data: {
    amount: number;
    transaction_date: Date;
    is_pending: boolean;
    plaid_primary_category: string;
    plaid_detailed_category: string;
  }
): MaterialChangeResult {
  const changed_fields: MaterialChangeField[] = [];

  // Amount change (threshold for floating point comparison)
  const amount_diff = Math.abs(new_data.amount - existing.amount);
  if (amount_diff > MATERIAL_AMOUNT_CHANGE_THRESHOLD) {
    changed_fields.push("amount");
  }

  // Date change
  if (new_data.transaction_date.getTime() !== existing.transaction_date.getTime()) {
    changed_fields.push("date");
  }

  // Pending status change
  if (new_data.is_pending !== existing.is_pending) {
    changed_fields.push("pending");
  }

  // Category change
  if (
    new_data.plaid_primary_category !== existing.plaid_primary_category ||
    new_data.plaid_detailed_category !== existing.plaid_detailed_category
  ) {
    changed_fields.push("category");
  }

  return {
    has_material_change: changed_fields.length > 0,
    changed_fields,
    old_amount: changed_fields.includes("amount") ? existing.amount : undefined,
    new_amount: changed_fields.includes("amount") ? new_data.amount : undefined,
  };
}

// ============================================================================
// Pending to Posted Migration (PURE)
// ============================================================================

/**
 * Calculates proportional split amounts when transaction amount changes.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * When a pending transaction posts with a different amount,
 * we adjust each split proportionally to preserve the user's allocation.
 *
 * @param splits - Original splits from pending transaction
 * @param old_amount - Original total amount
 * @param new_amount - New total amount after posting
 * @returns Adjusted splits with proportional amounts
 */
export function calculate_proportional_splits(
  splits: TransactionSplitForMigration[],
  old_amount: number,
  new_amount: number
): TransactionSplitForMigration[] {
  if (old_amount === 0) {
    // Avoid division by zero - distribute evenly
    const per_split = new_amount / splits.length;
    return splits.map(s => ({
      ...s,
      amount: per_split,
    }));
  }

  const ratio = new_amount / old_amount;

  return splits.map(s => ({
    ...s,
    amount: Math.round(s.amount * ratio * 100) / 100, // Round to 2 decimal places
  }));
}

/**
 * Merges user modifications from pending transaction to posted transaction.
 *
 * PURE FUNCTION - no IO, deterministic.
 * Returns TransactionForPersistence WITHOUT timestamps (repository adds those).
 *
 * Preserves:
 * - User's internal categories
 * - User's split allocations (budgets, outflows)
 * - User's tags
 * - Split structure (adjusted proportionally if amount changed)
 *
 * @param posted_transaction - New transaction from Plaid (posted)
 * @param migration - Migration data with pending transaction info
 * @returns Merged transaction ready for persistence
 */
export function merge_pending_to_posted(
  posted_transaction: TransactionForPersistence,
  migration: PendingMigration
): TransactionForPersistence {
  const pending = migration.pending_transaction;

  // Calculate adjusted splits if amount changed
  let migrated_splits: TransactionSplitForMigration[];
  if (migration.amount_changed) {
    migrated_splits = calculate_proportional_splits(
      pending.splits,
      migration.old_amount,
      migration.new_amount
    );
  } else {
    migrated_splits = pending.splits;
  }

  // Convert migrated splits to persistence format
  const final_splits: TransactionSplitForPersistence[] = migrated_splits.map(
    (pending_split, index) => {
      // Get corresponding split from posted transaction for Plaid categories
      const posted_split =
        posted_transaction.splits[index] || posted_transaction.splits[0];

      return {
        split_id: pending_split.split_id,
        amount: pending_split.amount,
        budget_id: pending_split.budget_id, // Preserve user's budget assignment
        outflow_id: pending_split.outflow_id, // Preserve user's outflow assignment
        monthly_period_id: posted_split?.monthly_period_id || null, // Use posted periods
        weekly_period_id: posted_split?.weekly_period_id || null,
        bi_weekly_period_id: posted_split?.bi_weekly_period_id || null,
        plaid_primary_category: posted_split?.plaid_primary_category || posted_transaction.plaid_primary_category,
        plaid_detailed_category: posted_split?.plaid_detailed_category || posted_transaction.plaid_detailed_category,
        internal_primary_category: pending_split.internal_primary_category, // Preserve user's category
        internal_detailed_category: pending_split.internal_detailed_category, // Preserve user's category
        is_default: pending_split.is_default,
        is_ignored: false,
        is_refund: false,
        is_tax_deductible: false,
        payment_date: posted_transaction.transaction_date,
        tags: pending_split.tags, // Preserve user's tags
        rules: [],
      };
    }
  );

  // Merge the transaction
  return {
    ...posted_transaction,
    // Preserve user's internal categories if set
    internal_primary_category:
      pending.internal_primary_category ||
      posted_transaction.internal_primary_category,
    internal_detailed_category:
      pending.internal_detailed_category ||
      posted_transaction.internal_detailed_category,
    // Use migrated splits
    splits: final_splits,
    // Clear pending status (now posted)
    is_pending: false,
    pending_transaction_id: migration.pending_plaid_transaction_id,
  };
}

// ============================================================================
// Result Aggregation (PURE)
// ============================================================================

/**
 * Aggregates sync results into a summary.
 *
 * PURE FUNCTION.
 */
export function aggregate_transaction_sync_results(
  added_count: number,
  modified_count: number,
  removed_count: number,
  pending_migrated_count: number,
  has_more: boolean,
  next_cursor: string | null,
  errors?: string[]
): {
  success: boolean;
  added_count: number;
  modified_count: number;
  removed_count: number;
  pending_migrated_count: number;
  has_more: boolean;
  next_cursor: string | null;
  error?: string;
} {
  const success = !errors || errors.length === 0;

  return {
    success,
    added_count,
    modified_count,
    removed_count,
    pending_migrated_count,
    has_more,
    next_cursor,
    error: errors && errors.length > 0 ? errors.join("; ") : undefined,
  };
}

/**
 * Determines if sync should continue after a partial failure.
 *
 * PURE FUNCTION.
 *
 * @param errors - Errors encountered so far
 * @param max_errors - Maximum errors before stopping
 * @returns Whether to continue syncing
 */
export function should_continue_sync(
  errors: string[],
  max_errors: number = 10
): boolean {
  return errors.length < max_errors;
}

/**
 * Normalizes a Plaid amount to always be positive.
 *
 * PURE FUNCTION.
 *
 * Plaid convention:
 * - Positive = money leaving account (expense)
 * - Negative = money entering account (income)
 *
 * We store as positive and track type separately.
 */
export function normalize_amount(plaid_amount: number): number {
  return Math.abs(plaid_amount);
}

/**
 * Determines transaction type from Plaid amount.
 *
 * PURE FUNCTION.
 */
export function determine_transaction_type(
  plaid_amount: number
): "income" | "expense" | "transfer" {
  if (plaid_amount < 0) {
    return "income";
  }
  return "expense";
}
