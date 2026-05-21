/**
 * Plaid Transaction Transformer
 *
 * PURE functions that convert Plaid transaction data to domain formats.
 * NO async, NO IO, NO side effects.
 *
 * @module integrations/plaid/plaid_transaction_transformer
 */

import { Transaction as PlaidTransaction } from "plaid";
import {
  TransactionForPersistence,
  TransactionSplitForPersistence,
  PendingTransactionInfo,
  PendingMigration,
} from "../../types/plaid";
import { DomainResult } from "../../types";

// ============================================================================
// Context Types
// ============================================================================

/**
 * Context for transforming Plaid transactions.
 */
export interface TransactionTransformContext {
  user_id: string;
  plaid_item_id: string;
  group_ids: string[];
  currency: string;
}

// ============================================================================
// Transform Functions (PURE)
// ============================================================================

/**
 * Transforms Plaid transactions to domain entities.
 *
 * PURE FUNCTION - no IO, deterministic.
 * Does NOT add timestamps - repository handles that.
 *
 * @param plaid_transactions - Raw transactions from Plaid /transactions/sync added array
 * @param context - Transformation context
 * @returns Domain result with entities or validation errors
 */
export function transform_plaid_transactions_to_domain(
  plaid_transactions: PlaidTransaction[],
  context: TransactionTransformContext
): DomainResult<TransactionForPersistence> {
  const validation_errors: string[] = [];
  const entities: TransactionForPersistence[] = [];

  for (const plaid_txn of plaid_transactions) {
    // Validate required fields
    if (!plaid_txn.transaction_id) {
      validation_errors.push("Transaction missing transaction_id");
      continue;
    }

    if (!plaid_txn.account_id) {
      validation_errors.push(`Transaction ${plaid_txn.transaction_id} missing account_id`);
      continue;
    }

    // Determine transaction type based on amount
    // Plaid: positive = money out (expense), negative = money in (income)
    const amount = plaid_txn.amount ?? 0;
    const type = determine_transaction_type(amount);

    // Extract categories
    const plaid_primary = plaid_txn.personal_finance_category?.primary || "OTHER";
    const plaid_detailed = plaid_txn.personal_finance_category?.detailed || "OTHER_OTHER";

    // Create default split (entire transaction amount)
    const default_split = create_default_split(
      plaid_txn.transaction_id,
      Math.abs(amount),
      plaid_txn.date,
      plaid_primary,
      plaid_detailed
    );

    // Transform to domain entity
    const entity: TransactionForPersistence = {
      // No id - repo will assign if new
      transaction_id: plaid_txn.transaction_id,
      user_id: context.user_id,
      group_ids: context.group_ids,
      is_active: true,

      // Plaid references
      plaid_item_id: context.plaid_item_id,
      account_id: plaid_txn.account_id,

      // Transaction details
      amount: Math.abs(amount), // Store as positive
      currency: plaid_txn.iso_currency_code || context.currency,
      transaction_date: new Date(plaid_txn.date),
      name: plaid_txn.name || "Unknown Transaction",
      merchant_name: plaid_txn.merchant_name || null,

      // Status
      is_pending: plaid_txn.pending ?? false,
      pending_transaction_id: plaid_txn.pending_transaction_id || null,
      type,
      source: "plaid",

      // Categories
      plaid_primary_category: plaid_primary,
      plaid_detailed_category: plaid_detailed,
      internal_primary_category: null, // Will be set by category matching
      internal_detailed_category: null,

      // Default split
      splits: [default_split],

      // Preserve initial Plaid data
      initial_plaid_data: {
        plaid_account_id: plaid_txn.account_id,
        plaid_merchant_name: plaid_txn.merchant_name || null,
        plaid_name: plaid_txn.name || "",
        plaid_transaction_id: plaid_txn.transaction_id,
        plaid_pending: plaid_txn.pending ?? false,
      },
    };

    entities.push(entity);
  }

  if (validation_errors.length > 0) {
    return { entities, validation_errors };
  }

  return { entities };
}

/**
 * Identifies transactions that need pending->posted migration.
 *
 * When a pending transaction posts, Plaid:
 * 1. Adds it to the 'removed' array (old pending ID)
 * 2. Adds a NEW transaction to 'added' with a new ID
 * 3. The new transaction has pending_transaction_id pointing to the old ID
 *
 * PURE FUNCTION - no IO.
 *
 * @param added_transactions - Added transactions from Plaid sync
 * @param pending_lookup - Map of plaid_transaction_id -> our pending transaction info
 * @returns List of migrations to perform
 */
export function identify_pending_migrations(
  added_transactions: PlaidTransaction[],
  pending_lookup: Map<string, PendingTransactionInfo>
): PendingMigration[] {
  const migrations: PendingMigration[] = [];

  for (const plaid_txn of added_transactions) {
    // Check if this posted transaction links to a pending we have
    if (!plaid_txn.pending_transaction_id) {
      continue;
    }

    const pending = pending_lookup.get(plaid_txn.pending_transaction_id);
    if (!pending) {
      // We don't have the pending transaction - might have been deleted or never synced
      // This is not an error, just means we can't migrate user modifications
      continue;
    }

    const new_amount = Math.abs(plaid_txn.amount ?? 0);
    const old_amount = pending.amount;
    const amount_changed = Math.abs(new_amount - old_amount) > 0.01;

    migrations.push({
      posted_plaid_transaction_id: plaid_txn.transaction_id,
      pending_plaid_transaction_id: plaid_txn.pending_transaction_id,
      pending_transaction: pending,
      amount_changed,
      old_amount,
      new_amount,
    });
  }

  return migrations;
}

/**
 * Extracts transaction IDs from Plaid's removed array.
 *
 * PURE FUNCTION.
 *
 * @param removed - Removed transactions from Plaid sync
 * @returns Array of transaction IDs to soft-delete
 */
export function extract_removed_transaction_ids(
  removed: Array<{ transaction_id: string }>
): string[] {
  return removed
    .filter(r => r.transaction_id)
    .map(r => r.transaction_id);
}

/**
 * Checks if a transaction was materially modified.
 *
 * Material changes require re-running the formatting pipeline:
 * - Amount changed (more than $0.01)
 * - Date changed
 * - Pending status changed
 * - Category changed
 *
 * PURE FUNCTION.
 *
 * @param plaid_txn - Modified transaction from Plaid
 * @param existing - Our stored transaction data
 * @returns Whether material changes exist
 */
export function has_material_changes(
  plaid_txn: PlaidTransaction,
  existing: {
    amount: number;
    transaction_date: Date;
    is_pending: boolean;
    plaid_primary_category: string;
    plaid_detailed_category: string;
  }
): boolean {
  // Amount change
  const new_amount = Math.abs(plaid_txn.amount ?? 0);
  if (Math.abs(new_amount - existing.amount) > 0.01) {
    return true;
  }

  // Date change
  const new_date = new Date(plaid_txn.date);
  if (new_date.getTime() !== existing.transaction_date.getTime()) {
    return true;
  }

  // Pending status change
  const new_pending = plaid_txn.pending ?? false;
  if (new_pending !== existing.is_pending) {
    return true;
  }

  // Category change
  const new_primary = plaid_txn.personal_finance_category?.primary || "OTHER";
  const new_detailed = plaid_txn.personal_finance_category?.detailed || "OTHER_OTHER";
  if (new_primary !== existing.plaid_primary_category ||
      new_detailed !== existing.plaid_detailed_category) {
    return true;
  }

  return false;
}

/**
 * Determines which fields changed in a modified transaction.
 *
 * PURE FUNCTION.
 */
export function get_changed_fields(
  plaid_txn: PlaidTransaction,
  existing: {
    amount: number;
    transaction_date: Date;
    is_pending: boolean;
    plaid_primary_category: string;
  }
): Array<"amount" | "date" | "pending" | "category"> {
  const changed: Array<"amount" | "date" | "pending" | "category"> = [];

  const new_amount = Math.abs(plaid_txn.amount ?? 0);
  if (Math.abs(new_amount - existing.amount) > 0.01) {
    changed.push("amount");
  }

  const new_date = new Date(plaid_txn.date);
  if (new_date.getTime() !== existing.transaction_date.getTime()) {
    changed.push("date");
  }

  const new_pending = plaid_txn.pending ?? false;
  if (new_pending !== existing.is_pending) {
    changed.push("pending");
  }

  const new_primary = plaid_txn.personal_finance_category?.primary || "OTHER";
  if (new_primary !== existing.plaid_primary_category) {
    changed.push("category");
  }

  return changed;
}

// ============================================================================
// Helper Functions (PURE)
// ============================================================================

/**
 * Determines transaction type from Plaid amount.
 *
 * Plaid convention:
 * - Positive amount = money leaving account (expense)
 * - Negative amount = money entering account (income)
 *
 * PURE FUNCTION.
 */
function determine_transaction_type(
  amount: number
): "income" | "expense" | "transfer" {
  if (amount < 0) {
    return "income";
  }
  return "expense";
}

/**
 * Creates a default split for a transaction.
 *
 * PURE FUNCTION - no timestamps (payment_date uses transaction date).
 */
function create_default_split(
  transaction_id: string,
  amount: number,
  date_string: string,
  plaid_primary: string,
  plaid_detailed: string
): TransactionSplitForPersistence {
  return {
    split_id: `${transaction_id}_default`,
    amount,
    budget_id: "unassigned", // Will be set by budget matching
    outflow_id: null,
    monthly_period_id: null, // Will be set by period matching
    weekly_period_id: null,
    bi_weekly_period_id: null,
    plaid_primary_category: plaid_primary,
    plaid_detailed_category: plaid_detailed,
    internal_primary_category: null,
    internal_detailed_category: null,
    is_default: true,
    is_ignored: false,
    is_refund: false,
    is_tax_deductible: false,
    payment_date: new Date(date_string),
    tags: [],
    rules: [],
  };
}

/**
 * Maps Plaid category to internal category.
 *
 * PURE FUNCTION.
 *
 * This provides basic category mapping. The full category matching
 * is done by the existing matchCategoriesToTransactions utility.
 */
export function map_plaid_category_to_internal(
  plaid_primary: string,
  plaid_detailed: string
): { primary: string | null; detailed: string | null } {
  // Basic mapping - returns null to let existing category matcher handle it
  // This is a passthrough as the existing matchCategoriesToTransactions
  // utility does sophisticated merchant/keyword matching
  return {
    primary: null,
    detailed: null,
  };
}
