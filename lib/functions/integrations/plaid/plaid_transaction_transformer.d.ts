/**
 * Plaid Transaction Transformer
 *
 * PURE functions that convert Plaid transaction data to domain formats.
 * NO async, NO IO, NO side effects.
 *
 * @module integrations/plaid/plaid_transaction_transformer
 */
import { Transaction as PlaidTransaction } from "plaid";
import { TransactionForPersistence, PendingTransactionInfo, PendingMigration } from "../../types/plaid";
import { DomainResult } from "../../types";
/**
 * Context for transforming Plaid transactions.
 */
export interface TransactionTransformContext {
    user_id: string;
    plaid_item_id: string;
    group_ids: string[];
    currency: string;
}
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
export declare function transform_plaid_transactions_to_domain(plaid_transactions: PlaidTransaction[], context: TransactionTransformContext): DomainResult<TransactionForPersistence>;
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
export declare function identify_pending_migrations(added_transactions: PlaidTransaction[], pending_lookup: Map<string, PendingTransactionInfo>): PendingMigration[];
/**
 * Extracts transaction IDs from Plaid's removed array.
 *
 * PURE FUNCTION.
 *
 * @param removed - Removed transactions from Plaid sync
 * @returns Array of transaction IDs to soft-delete
 */
export declare function extract_removed_transaction_ids(removed: Array<{
    transaction_id: string;
}>): string[];
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
export declare function has_material_changes(plaid_txn: PlaidTransaction, existing: {
    amount: number;
    transaction_date: Date;
    is_pending: boolean;
    plaid_primary_category: string;
    plaid_detailed_category: string;
}): boolean;
/**
 * Determines which fields changed in a modified transaction.
 *
 * PURE FUNCTION.
 */
export declare function get_changed_fields(plaid_txn: PlaidTransaction, existing: {
    amount: number;
    transaction_date: Date;
    is_pending: boolean;
    plaid_primary_category: string;
}): Array<"amount" | "date" | "pending" | "category">;
/**
 * Maps Plaid category to internal category.
 *
 * PURE FUNCTION.
 *
 * This provides basic category mapping. The full category matching
 * is done by the existing matchCategoriesToTransactions utility.
 */
export declare function map_plaid_category_to_internal(plaid_primary: string, plaid_detailed: string): {
    primary: string | null;
    detailed: string | null;
};
//# sourceMappingURL=plaid_transaction_transformer.d.ts.map