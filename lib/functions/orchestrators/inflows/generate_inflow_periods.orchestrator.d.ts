/**
 * Generate Inflow Periods Orchestrator
 *
 * Coordinates the generation of inflow_period documents when a new inflow is created.
 * Follows the 5-layer architecture: Entry → Orchestrator → Resolver → Domain → Repository.
 *
 * @module orchestrators/inflows/generate_inflow_periods
 */
import { TraceContext, PerformanceBudget } from "../../types";
/**
 * Performance budget for inflow period generation.
 * Generous limits since this is triggered by inflow creation.
 */
export declare const GENERATE_INFLOW_PERIODS_BUDGET: PerformanceBudget;
/**
 * Input for the generate inflow periods orchestrator.
 */
export interface GenerateInflowPeriodsInput {
    inflow_id: string;
    inflow_data: Record<string, unknown>;
    user_id: string;
}
/**
 * Result from the generate inflow periods orchestrator.
 */
export interface GenerateInflowPeriodsResult {
    success: boolean;
    periods_created: number;
    errors?: string[];
    trace_id: string;
}
/**
 * Orchestrator context for inflow period generation.
 */
export interface GenerateInflowPeriodsContext extends TraceContext {
    input: GenerateInflowPeriodsInput;
    idempotency_key: string;
}
/**
 * Generate inflow periods for a newly created inflow.
 *
 * This orchestrator:
 * 1. Resolves dependencies (inflow data + source periods)
 * 2. Computes inflow periods using domain service (PURE)
 * 3. Validates periods before persistence
 * 4. Saves periods to Firestore
 *
 * @param ctx - Orchestrator context with trace info and input
 * @returns Result with periods created count
 */
export declare function generate_inflow_periods_orchestrator(ctx: GenerateInflowPeriodsContext): Promise<GenerateInflowPeriodsResult>;
//# sourceMappingURL=generate_inflow_periods.orchestrator.d.ts.map