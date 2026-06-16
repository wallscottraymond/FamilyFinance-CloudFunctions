/**
 * Outflow Period Repository
 *
 * Handles persistence for outflow_periods collection.
 * Used to link transactions to recurring bills (outflows).
 *
 * @module repositories/outflow_period
 */
import { Timestamp } from "firebase-admin/firestore";
import { WriteResult, BatchWriteResult, TraceContext } from "../types";
import { ReconciliationResult } from "../domain/recurring/period_reconciliation.service";
/**
 * Outflow period update structure (snake_case - domain format).
 * Matches the output from match_transaction_splits_to_outflows.
 */
export interface OutflowPeriodUpdate {
    period_id: string;
    transaction_split_ref: {
        transaction_id: string;
        split_id: string;
        amount: number;
        payment_date: Timestamp;
    };
}
/**
 * Outflow period entity for persistence (snake_case - domain format).
 */
export interface OutflowPeriodForPersistence {
    id: string;
    outflow_id: string;
    source_period_id: string;
    owner_id: string;
    created_by: string;
    updated_by: string;
    group_id: string | null;
    group_ids: string[];
    account_id: string;
    plaid_item_id: string;
    actual_amount: number | null;
    amount_withheld: number;
    average_amount: number;
    expected_amount: number;
    amount_per_occurrence: number;
    total_amount_due: number;
    total_amount_paid: number;
    total_amount_unpaid: number;
    created_at: Timestamp;
    updated_at: Timestamp;
    last_calculated: Timestamp;
    currency: string;
    cycle_days: number;
    cycle_start_date: Timestamp;
    cycle_end_date: Timestamp;
    daily_withholding_rate: number;
    description: string | null;
    frequency: string;
    expense_type?: string;
    is_paid: boolean;
    is_fully_paid: boolean;
    is_partially_paid: boolean;
    is_due_period: boolean;
    internal_detailed_category: string | null;
    internal_primary_category: string | null;
    plaid_primary_category: string;
    plaid_detailed_category: string;
    is_active: boolean;
    is_hidden: boolean;
    is_essential: boolean;
    merchant_name: string | null;
    period_start_date: Timestamp;
    period_end_date: Timestamp;
    period_type: string;
    predicted_next_date: Timestamp | null;
    rules: unknown[];
    tags: string[];
    type: string;
    note: string | null;
    user_custom_name: string | null;
    source: string;
    transaction_ids: string[];
    transaction_splits: unknown[];
    number_of_occurrences_in_period: number;
    number_of_occurrences_paid: number;
    number_of_occurrences_unpaid: number;
    occurrence_due_dates: Timestamp[];
    occurrence_paid_flags: boolean[];
    occurrence_transaction_ids: (string | null)[];
    payment_progress_percentage: number;
    dollar_progress_percentage: number;
    first_due_date_in_period: Timestamp | null;
    last_due_date_in_period: Timestamp | null;
    next_unpaid_due_date: Timestamp | null;
}
/**
 * Outflow Period Repository
 *
 * Handles updates to outflow_periods when transactions are linked.
 */
export declare const outflow_period_repo: {
    /**
     * Saves a batch of outflow periods.
     *
     * Creates new outflow period documents for a recurring outflow.
     * Called when a new outflow is created or when periods need to be extended.
     */
    save_batch(ctx: TraceContext, entities: OutflowPeriodForPersistence[], user_id: string): Promise<BatchWriteResult>;
    /**
     * Updates outflow periods with transaction split references.
     *
     * Called after transactions are persisted to link them to recurring bills.
     * This operation:
     * - Adds transaction split references to the period's transactionSplits array
     * - Sets the period status to 'paid'
     * - Creates audit entries for each update
     *
     * @param ctx - Trace context for logging
     * @param updates - Array of period updates to apply
     * @returns Write results for each updated period
     */
    update_with_transaction_splits(ctx: TraceContext, updates: OutflowPeriodUpdate[]): Promise<WriteResult[]>;
    /**
     * Removes transaction split references from outflow periods.
     *
     * Used when transactions are soft-deleted to unlink them from bills.
     *
     * @param ctx - Trace context
     * @param period_id - Outflow period ID
     * @param transaction_id - Transaction ID to remove
     * @param split_id - Split ID to remove
     * @param new_status - New status to set (computed by orchestrator/domain layer)
     * @returns Write result
     */
    remove_transaction_split(ctx: TraceContext, period_id: string, transaction_id: string, split_id: string, new_status: string): Promise<WriteResult | null>;
    /**
     * Gets the raw doc data + id for a set of period IDs (missing docs skipped).
     * READ-ONLY — used by the summary resolver to group periods for recompute.
     */
    get_by_ids(_ctx: TraceContext, period_ids: string[]): Promise<Array<{
        id: string;
        data: Record<string, unknown>;
    }>>;
    /**
     * Gets outflow periods (raw doc data + id) whose `firstDueDateInPeriod` falls in
     * [start_ms, end_ms]. READ-ONLY — used by the recurring-match resolver to load
     * bill candidates around a transaction date. (Only DUE periods have a non-null
     * `firstDueDateInPeriod`, which is exactly the candidate set we want.)
     *
     * Composite index: `outflow_periods(userId, firstDueDateInPeriod)`.
     */
    get_in_due_window(_ctx: TraceContext, user_id: string, start_ms: number, end_ms: number): Promise<Array<{
        id: string;
        data: Record<string, unknown>;
    }>>;
    /**
     * Soft-deletes (or restores) every outflow period for an account in one shot.
     * Sets `isActive` to `is_active` on all periods whose `accountId` matches and
     * whose current state differs (idempotent — re-running is a no-op).
     *
     * Used by the account-removal cascade (`is_active = false`) and the restore
     * flow (`is_active = true`). Queries by `accountId` only (single-field index)
     * and filters in memory to avoid a composite index; period counts per account
     * are bounded (hundreds), and writes are chunked into batches of ≤500.
     *
     * @returns number of periods updated
     */
    set_active_by_account_id(ctx: TraceContext, account_id: string, is_active: boolean): Promise<number>;
    /**
     * Returns the period ids for a recurring outflow (mirror of
     * `inflow_period_repo.get_by_inflow_id`). The resolver loads the docs via
     * `get_by_ids` and filters active in memory.
     */
    get_by_outflow_id(ctx: TraceContext, outflow_id: string): Promise<string[]>;
    /**
     * Persists reconciliation status (Recurring-Period-Reconciliation Phase 3d).
     * Writes the `reconciliation` map + the denormalized legacy `isPaid`/`amountPaid`
     * fields in place, batched, **NOT** `increment` (invalidation model). The
     * orchestrator is responsible for NOT passing inactive periods.
     */
    update_reconciliation(_ctx: TraceContext, results: ReconciliationResult[]): Promise<WriteResult[]>;
    /**
     * Merge-update ONLY the generation-derived occurrence fields on existing periods
     * (Recurring-Period-Reconciliation B — occurrence regeneration). Preserves the
     * payment/reconciliation state (`reconciliation`, `isPaid`, `transactionSplits`):
     * uses `batch.update`, so callers MUST pass only periods that already exist.
     */
    update_occurrence_fields(_ctx: TraceContext, entities: OutflowPeriodForPersistence[]): Promise<WriteResult[]>;
};
//# sourceMappingURL=outflow_period.repo.d.ts.map