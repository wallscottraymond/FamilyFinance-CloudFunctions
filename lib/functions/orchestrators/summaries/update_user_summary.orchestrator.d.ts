/**
 * Update User Summary Orchestrator
 *
 * Coordinates the update of user period summaries following the 5-layer architecture:
 * Entry → Orchestrator → Resolver → Domain → Repository
 *
 * @module orchestrators/summaries/update_user_summary
 */
import { TraceContext, PerformanceBudget } from "../../types";
/**
 * Performance budget for user summary update.
 */
export declare const UPDATE_USER_SUMMARY_BUDGET: PerformanceBudget;
/**
 * Input for updating a single user summary.
 */
export interface UpdateUserSummaryInput {
    user_id: string;
    period_type: string;
    source_period_id: string;
}
/**
 * Result from updating a user summary.
 */
export interface UpdateUserSummaryResult {
    success: boolean;
    summary_id: string | null;
    errors?: string[];
    trace_id: string;
}
/**
 * Orchestrator context for user summary update.
 */
export interface UpdateUserSummaryContext extends TraceContext {
    input: UpdateUserSummaryInput;
}
/**
 * Update a single user period summary.
 *
 * Follows the 5-layer architecture:
 * 1. Resolver: Fetch source period and all resource periods
 * 2. Domain: Compute summary from resource periods (PURE)
 * 3. Domain: Validate summary (PURE)
 * 4. Repository: Save summary to Firestore
 *
 * @param ctx - Orchestrator context with trace info and input
 * @returns Result with summary ID or errors
 */
export declare function update_user_summary_orchestrator(ctx: UpdateUserSummaryContext): Promise<UpdateUserSummaryResult>;
/**
 * Enqueue user-summary update jobs from already-resolved (period_type,
 * source_period) pairs. Use this when the underlying period documents are about
 * to be (or have been) deleted, so they can't be resolved by ID — e.g. the
 * budget delete cascade captures the pairs before deletion and enqueues after.
 *
 * @param ctx - Trace context
 * @param user_id - The user ID
 * @param periods_by_type - Map of period_type → set of source_period_ids
 * @returns Count of jobs enqueued
 */
export declare function enqueue_user_summary_updates_by_type(ctx: TraceContext, user_id: string, periods_by_type: Map<string, Set<string>>): Promise<number>;
/**
 * Enqueue user-summary update jobs for the given outflow periods.
 * Graph-oriented: routes through the shared `update_user_summary` job node.
 *
 * @param ctx - Trace context
 * @param user_id - The user ID
 * @param outflow_period_ids - Array of outflow_period document IDs
 * @returns Count of jobs enqueued
 */
export declare function enqueue_user_summary_updates_from_outflow_periods(ctx: TraceContext, user_id: string, outflow_period_ids: string[]): Promise<number>;
/**
 * Update user summaries from inflow period IDs.
 *
 * Convenience function that extracts period info from inflow_period documents
 * and updates the corresponding user summaries.
 *
 * Uses the period_lookup.resolver for proper layer separation.
 *
 * @param ctx - Trace context
 * @param user_id - The user ID
 * @param inflow_period_ids - Array of inflow_period document IDs
 * @returns Count of summaries updated
 */
export declare function enqueue_user_summary_updates_from_inflow_periods(ctx: TraceContext, user_id: string, inflow_period_ids: string[]): Promise<number>;
/**
 * Enqueue user-summary update jobs for the given budget periods.
 * Graph-oriented: routes through the shared `update_user_summary` job node.
 *
 * @param ctx - Trace context
 * @param user_id - The user ID
 * @param budget_period_ids - Array of budget_period document IDs
 * @returns Count of jobs enqueued
 */
export declare function enqueue_user_summary_updates_from_budget_periods(ctx: TraceContext, user_id: string, budget_period_ids: string[]): Promise<number>;
//# sourceMappingURL=update_user_summary.orchestrator.d.ts.map