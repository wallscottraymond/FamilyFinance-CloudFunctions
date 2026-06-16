/**
 * Inflow Period Repository
 *
 * Handles persistence for inflow_periods collection.
 * Creates period-specific instances of recurring inflows.
 *
 * @module repositories/inflow_period
 */
import { Timestamp } from "firebase-admin/firestore";
import { WriteResult, BatchWriteResult, TraceContext } from "../types";
import { ReconciliationResult } from "../domain/recurring/period_reconciliation.service";
/**
 * Inflow period entity for persistence (snake_case - domain format).
 */
export interface InflowPeriodForPersistence {
    id: string;
    inflow_id: string;
    source_period_id: string;
    owner_id: string;
    created_by: string;
    updated_by: string;
    group_id: string | null;
    group_ids: string[];
    account_id: string;
    plaid_item_id: string;
    actual_amount: number | null;
    amount_allocated: number;
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
    income_type?: string;
    is_paid: boolean;
    is_fully_paid: boolean;
    is_partially_paid: boolean;
    is_receipt_period: boolean;
    internal_detailed_category: string | null;
    internal_primary_category: string | null;
    plaid_primary_category: string;
    plaid_detailed_category: string;
    is_active: boolean;
    is_hidden: boolean;
    merchant: string | null;
    payee: string | null;
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
    number_of_occurrences_in_period: number;
    number_of_occurrences_paid: number;
    number_of_occurrences_unpaid: number;
    occurrence_due_dates: Timestamp[];
    occurrence_paid_flags: boolean[];
    occurrence_transaction_ids: (string | null)[];
    occurrence_amounts: number[];
    payment_progress_percentage: number;
    dollar_progress_percentage: number;
    first_due_date_in_period: Timestamp | null;
    last_due_date_in_period: Timestamp | null;
    next_unpaid_due_date: Timestamp | null;
}
/**
 * Inflow Period Repository
 *
 * All write operations automatically create audit entries.
 */
export declare const inflow_period_repo: {
    /**
     * Saves a batch of inflow periods.
     *
     * Creates new inflow period documents for a recurring inflow.
     * Called when a new inflow is created or when periods need to be extended.
     */
    save_batch(ctx: TraceContext, entities: InflowPeriodForPersistence[], user_id: string): Promise<BatchWriteResult>;
    /**
     * Gets inflow periods by inflow ID.
     */
    get_by_inflow_id(ctx: TraceContext, inflow_id: string): Promise<string[]>;
    /**
     * Gets the raw doc data + id for a set of period IDs (missing docs skipped).
     * READ-ONLY — used by the summary resolver to group periods for recompute.
     */
    get_by_ids(_ctx: TraceContext, period_ids: string[]): Promise<Array<{
        id: string;
        data: Record<string, unknown>;
    }>>;
    /**
     * Deletes all inflow periods for an inflow.
     *
     * Used when regenerating periods or soft-deleting an inflow.
     */
    delete_by_inflow_id(ctx: TraceContext, inflow_id: string, user_id: string): Promise<WriteResult[]>;
    /**
     * Soft-deletes (or restores) every inflow period for an account in one shot.
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
     * Inflow periods whose `firstDueDateInPeriod` falls in [start_ms, end_ms].
     * READ-ONLY — used by the recurring-match resolver to load income candidates
     * (mirror of `outflow_period_repo.get_in_due_window`).
     * Composite index: `inflow_periods(userId, firstDueDateInPeriod)`.
     */
    get_in_due_window(_ctx: TraceContext, user_id: string, start_ms: number, end_ms: number): Promise<Array<{
        id: string;
        data: Record<string, unknown>;
    }>>;
    /**
     * Persists reconciliation status (Recurring-Period-Reconciliation Phase 3d).
     * Writes the `reconciliation` map + the denormalized legacy `isPaid`/`amountPaid`
     * fields in place, batched, **NOT** `increment` (invalidation model). The
     * orchestrator is responsible for NOT passing inactive periods. (Inflow reuses
     * the existing `isPaid` field for "received"; richer status lives in `reconciliation`.)
     */
    update_reconciliation(_ctx: TraceContext, results: ReconciliationResult[]): Promise<WriteResult[]>;
    /**
     * Merge-update ONLY the generation-derived occurrence fields on existing periods
     * (Recurring-Period-Reconciliation B — occurrence regeneration). Preserves the
     * payment/reconciliation state: uses `batch.update`, so callers MUST pass only
     * periods that already exist.
     */
    update_occurrence_fields(_ctx: TraceContext, entities: InflowPeriodForPersistence[]): Promise<WriteResult[]>;
};
//# sourceMappingURL=inflow_period.repo.d.ts.map