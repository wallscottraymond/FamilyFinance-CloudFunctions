/**
 * Transaction Sync Domain Service
 *
 * Pure business logic for transaction synchronization.
 * NO async, NO IO, NO side effects.
 *
 * @module domain/plaid/transaction_sync
 */
import { TransactionForPersistence, MaterialChangeResult, PendingMigration, TransactionValidationResult, TransactionSplitForMigration } from "../../types/plaid";
/**
 * Validates transactions before sync persistence.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param transactions - Transactions to validate
 * @returns Validation result with valid transactions and errors
 */
export declare function validate_transactions_for_sync(transactions: TransactionForPersistence[]): TransactionValidationResult;
/**
 * Detects material changes between existing and new transaction data.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param existing - Current transaction data
 * @param new_data - New data from Plaid
 * @returns Material change result
 */
export declare function detect_material_changes(existing: {
    amount: number;
    transaction_date: Date;
    is_pending: boolean;
    plaid_primary_category: string;
    plaid_detailed_category: string;
}, new_data: {
    amount: number;
    transaction_date: Date;
    is_pending: boolean;
    plaid_primary_category: string;
    plaid_detailed_category: string;
}): MaterialChangeResult;
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
export declare function calculate_proportional_splits(splits: TransactionSplitForMigration[], old_amount: number, new_amount: number): TransactionSplitForMigration[];
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
export declare function merge_pending_to_posted(posted_transaction: TransactionForPersistence, migration: PendingMigration): TransactionForPersistence;
/**
 * Aggregates sync results into a summary.
 *
 * PURE FUNCTION.
 */
export declare function aggregate_transaction_sync_results(added_count: number, modified_count: number, removed_count: number, pending_migrated_count: number, has_more: boolean, next_cursor: string | null, errors?: string[]): {
    success: boolean;
    added_count: number;
    modified_count: number;
    removed_count: number;
    pending_migrated_count: number;
    has_more: boolean;
    next_cursor: string | null;
    error?: string;
};
/**
 * Determines if sync should continue after a partial failure.
 *
 * PURE FUNCTION.
 *
 * @param errors - Errors encountered so far
 * @param max_errors - Maximum errors before stopping
 * @returns Whether to continue syncing
 */
export declare function should_continue_sync(errors: string[], max_errors?: number): boolean;
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
export declare function normalize_amount(plaid_amount: number): number;
/**
 * Determines transaction type from Plaid amount.
 *
 * PURE FUNCTION.
 */
export declare function determine_transaction_type(plaid_amount: number): "income" | "expense" | "transfer";
//# sourceMappingURL=transaction_sync.service.d.ts.map