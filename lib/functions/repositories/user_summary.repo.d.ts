/**
 * User Summary Repository
 *
 * Handles persistence for user_summaries collection.
 * Follows the 5-layer architecture pattern.
 *
 * @module repositories/user_summary
 */
import { Timestamp } from "firebase-admin/firestore";
import { WriteResult, TraceContext } from "../types";
import { UserPeriodSummary } from "../summaries/types/periodSummaries";
import { OutflowPeriod, BudgetPeriodDocument, InflowPeriod, SourcePeriod } from "../../types";
/**
 * User summary entity for persistence (snake_case - domain format).
 */
export interface UserSummaryForPersistence {
    id: string;
    user_id: string;
    source_period_id: string;
    period_type: string;
    period_start_date: Timestamp;
    period_end_date: Timestamp;
    year: number;
    month?: number;
    week_number?: number;
    bi_monthly_half?: 1 | 2;
    outflows: unknown[];
    budgets: unknown[];
    inflows: unknown[];
    goals: unknown[];
    last_recalculated: Timestamp;
    created_at: Timestamp;
    updated_at: Timestamp;
}
/**
 * User Summary Repository
 *
 * Handles persistence for user_summaries collection.
 */
export declare const user_summary_repo: {
    /**
     * Saves a user summary document.
     *
     * Creates or updates the summary document with a full replace operation.
     * This is the intended behavior - summaries are always recalculated completely.
     *
     * @param ctx - Trace context for logging
     * @param entity - The summary entity to save
     * @returns Write result
     */
    save(ctx: TraceContext, entity: UserSummaryForPersistence): Promise<WriteResult>;
    /**
     * Gets a user summary by ID.
     *
     * @param ctx - Trace context for logging
     * @param id - The summary document ID
     * @returns The summary entity or null if not found
     */
    get_by_id(ctx: TraceContext, id: string): Promise<UserSummaryForPersistence | null>;
    /**
     * Gets a user summary by user, period type, and source period.
     *
     * This is the most common query pattern for summaries.
     *
     * @param ctx - Trace context for logging
     * @param user_id - The user ID
     * @param period_type - The period type (e.g., "monthly")
     * @param source_period_id - The source period ID (e.g., "2025M06")
     * @returns The summary entity or null if not found
     */
    get_by_user_and_period(ctx: TraceContext, user_id: string, period_type: string, source_period_id: string): Promise<UserSummaryForPersistence | null>;
    /**
     * Maps a UserPeriodSummary (camelCase frontend format) to UserSummaryForPersistence (snake_case domain format).
     *
     * Helper function for converting existing summary objects to the persistence format.
     */
    map_from_user_period_summary(summary: UserPeriodSummary): UserSummaryForPersistence;
    /**
     * Atomically updates a user summary using a Firestore transaction.
     *
     * This prevents race conditions by:
     * 1. Reading the existing summary (establishes conflict detection)
     * 2. Reading all dependent period documents inside the transaction
     * 3. Computing the new summary with fresh data
     * 4. Writing atomically
     *
     * If the summary document changes between read and write, Firestore
     * automatically retries the transaction with fresh data.
     *
     * @param ctx - Trace context for logging
     * @param summary_id - The summary document ID
     * @param user_id - The user ID
     * @param source_period_id - The source period ID
     * @param period_type - The period type
     * @param compute_fn - Function to compute the summary from dependencies
     * @returns Write result
     */
    save_with_transaction(ctx: TraceContext, summary_id: string, user_id: string, source_period_id: string, period_type: string, compute_fn: (deps: TransactionDependencies) => UserSummaryForPersistence): Promise<WriteResult>;
};
/**
 * Dependencies provided to the compute function during transactional update.
 */
export interface TransactionDependencies {
    source_period: SourcePeriod;
    outflow_periods: OutflowPeriod[];
    budget_periods: BudgetPeriodDocument[];
    inflow_periods: InflowPeriod[];
}
//# sourceMappingURL=user_summary.repo.d.ts.map