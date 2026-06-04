/**
 * Period Lookup Resolver
 *
 * Resolves period documents by IDs for summary updates and groups them by
 * (period_type → source_period_ids) for recompute fan-out.
 * READ-ONLY: No business logic, no mutations. All reads go through repositories.
 *
 * @module resolvers/summaries/period_lookup
 */
import { TraceContext } from "../../types";
/**
 * Period info extracted for summary grouping.
 */
export interface PeriodInfo {
    id: string;
    period_type: string;
    source_period_id: string;
}
/**
 * Grouped periods by period type.
 */
export interface GroupedPeriods {
    /** Map of period_type -> Set of source_period_ids */
    periods_by_type: Map<string, Set<string>>;
}
/**
 * Resolve outflow period info by document IDs.
 *
 * @param ctx - Trace context for logging
 * @param period_ids - Array of outflow_period document IDs
 * @returns Grouped periods by type
 */
export declare function resolve_outflow_periods_for_summary(ctx: TraceContext, period_ids: string[]): Promise<GroupedPeriods>;
/**
 * Resolve inflow period info by document IDs.
 *
 * @param ctx - Trace context for logging
 * @param period_ids - Array of inflow_period document IDs
 * @returns Grouped periods by type
 */
export declare function resolve_inflow_periods_for_summary(ctx: TraceContext, period_ids: string[]): Promise<GroupedPeriods>;
/**
 * Resolve budget period info by document IDs.
 *
 * @param ctx - Trace context for logging
 * @param period_ids - Array of budget_period document IDs
 * @returns Grouped periods by type
 */
export declare function resolve_budget_periods_for_summary(ctx: TraceContext, period_ids: string[]): Promise<GroupedPeriods>;
//# sourceMappingURL=period_lookup.resolver.d.ts.map