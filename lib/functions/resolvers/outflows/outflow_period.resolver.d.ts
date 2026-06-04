/**
 * Outflow Period Resolver
 *
 * Resolves dependencies needed for outflow period generation.
 * Fetches source periods and outflow data.
 *
 * @module resolvers/outflows/outflow_period
 */
import { TraceContext, DependencyResult } from "../../types";
import { OutflowForPeriodGeneration, SourcePeriodForOutflowGeneration } from "../../domain/outflows";
/**
 * Input for resolving outflow period dependencies.
 */
export interface ResolveOutflowPeriodInput {
    outflow_id: string;
    user_id: string;
    /** Start date for period generation (defaults to outflow first_date) */
    start_date?: Date;
    /** End date for period generation (defaults to 12 months forward) */
    end_date?: Date;
}
/**
 * Dependencies resolved for outflow period generation.
 */
export interface OutflowPeriodDependencies {
    outflow: OutflowForPeriodGeneration;
    source_periods: SourcePeriodForOutflowGeneration[];
    dependency_result: DependencyResult;
}
/**
 * Resolve dependencies for outflow period generation.
 *
 * Fetches:
 * 1. The outflow document
 * 2. Source periods within the date range
 *
 * @param ctx - Trace context for logging
 * @param input - Resolution input with outflow ID and date range
 * @returns Dependencies needed for period generation
 */
export declare function resolve_outflow_period_dependencies(ctx: TraceContext, input: ResolveOutflowPeriodInput): Promise<OutflowPeriodDependencies>;
/**
 * Resolve outflow directly from Firestore document data.
 *
 * Used by triggers that have the document data already.
 * Avoids an extra read.
 *
 * @param ctx - Trace context
 * @param outflow_id - Outflow document ID
 * @param outflow_data - Raw Firestore document data (camelCase)
 * @param options - Optional date range overrides
 */
export declare function resolve_outflow_period_dependencies_from_doc(ctx: TraceContext, outflow_id: string, outflow_data: Record<string, unknown>, options?: {
    start_date?: Date;
    end_date?: Date;
}): Promise<OutflowPeriodDependencies>;
//# sourceMappingURL=outflow_period.resolver.d.ts.map