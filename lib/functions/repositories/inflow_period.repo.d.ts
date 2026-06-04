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
};
//# sourceMappingURL=inflow_period.repo.d.ts.map