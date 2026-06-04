/**
 * Inflow Period Resolver
 *
 * Resolves dependencies needed for inflow period generation.
 * Fetches source periods and inflow data.
 *
 * @module resolvers/inflows/inflow_period
 */
import { TraceContext, DependencyResult } from "../../types";
import { InflowForPeriodGeneration, SourcePeriodForGeneration } from "../../domain/inflows";
/**
 * Input for resolving inflow period dependencies.
 */
export interface ResolveInflowPeriodInput {
    inflow_id: string;
    user_id: string;
    /** Start date for period generation (defaults to inflow first_date) */
    start_date?: Date;
    /** End date for period generation (defaults to 12 months forward) */
    end_date?: Date;
}
/**
 * Dependencies resolved for inflow period generation.
 */
export interface InflowPeriodDependencies {
    inflow: InflowForPeriodGeneration;
    source_periods: SourcePeriodForGeneration[];
    dependency_result: DependencyResult;
}
/**
 * Resolve dependencies for inflow period generation.
 *
 * Fetches:
 * 1. The inflow document
 * 2. Source periods within the date range
 *
 * @param ctx - Trace context for logging
 * @param input - Resolution input with inflow ID and date range
 * @returns Dependencies needed for period generation
 */
export declare function resolve_inflow_period_dependencies(ctx: TraceContext, input: ResolveInflowPeriodInput): Promise<InflowPeriodDependencies>;
/**
 * Resolve inflow directly from Firestore document data.
 *
 * Used by triggers that have the document data already.
 * Avoids an extra read.
 *
 * @param ctx - Trace context
 * @param inflow_id - Inflow document ID
 * @param inflow_data - Raw Firestore document data (camelCase)
 * @param options - Optional date range overrides
 */
export declare function resolve_inflow_period_dependencies_from_doc(ctx: TraceContext, inflow_id: string, inflow_data: Record<string, unknown>, options?: {
    start_date?: Date;
    end_date?: Date;
}): Promise<InflowPeriodDependencies>;
//# sourceMappingURL=inflow_period.resolver.d.ts.map