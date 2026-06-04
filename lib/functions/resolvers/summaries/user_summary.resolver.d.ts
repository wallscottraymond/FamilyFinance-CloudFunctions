/**
 * User Summary Resolver
 *
 * Resolves dependencies needed for user period summary computation.
 * Fetches all resource periods (outflows, budgets, inflows) for a given period.
 *
 * READ-ONLY: No business logic, no mutations.
 *
 * @module resolvers/summaries/user_summary
 */
import { TraceContext, DependencyResult } from "../../types";
import { OutflowPeriod, BudgetPeriodDocument, InflowPeriod, SourcePeriod } from "../../../types";
/**
 * Input for resolving user summary dependencies.
 */
export interface ResolveUserSummaryInput {
    user_id: string;
    period_type: string;
    source_period_id: string;
}
/**
 * Dependencies resolved for user summary computation.
 */
export interface UserSummaryDependencies {
    source_period: SourcePeriod;
    outflow_periods: OutflowPeriod[];
    budget_periods: BudgetPeriodDocument[];
    inflow_periods: InflowPeriod[];
    dependency_result: DependencyResult;
}
/**
 * Resolve dependencies for user period summary computation.
 *
 * Fetches:
 * 1. The source period document
 * 2. All outflow_periods for the user and period
 * 3. All budget_periods for the user and period
 * 4. All inflow_periods for the user and period
 *
 * READ-ONLY: Only queries data, no mutations.
 *
 * @param ctx - Trace context for logging
 * @param input - Resolution input with user, period type, and source period
 * @returns Dependencies needed for summary computation
 */
export declare function resolve_user_summary_dependencies(ctx: TraceContext, input: ResolveUserSummaryInput): Promise<UserSummaryDependencies>;
/**
 * Batch resolve dependencies for multiple periods.
 *
 * Efficiently fetches dependencies for multiple source periods at once.
 * Used when updating summaries for multiple periods (e.g., after outflow creation).
 *
 * @param ctx - Trace context for logging
 * @param user_id - The user ID
 * @param period_type - The period type
 * @param source_period_ids - Array of source period IDs
 * @returns Map of source_period_id to dependencies
 */
export declare function batch_resolve_user_summary_dependencies(ctx: TraceContext, user_id: string, period_type: string, source_period_ids: string[]): Promise<Map<string, UserSummaryDependencies>>;
//# sourceMappingURL=user_summary.resolver.d.ts.map