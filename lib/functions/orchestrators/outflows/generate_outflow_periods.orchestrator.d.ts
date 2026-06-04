/**
 * Generate Outflow Periods Orchestrator
 *
 * Coordinates the generation of outflow_period documents when a new outflow is created.
 * Follows the 5-layer architecture: Entry → Orchestrator → Resolver → Domain → Repository.
 *
 * @module orchestrators/outflows/generate_outflow_periods
 */
import { TraceContext, PerformanceBudget } from "../../types";
/**
 * Performance budget for outflow period generation.
 * Generous limits since this is triggered by outflow creation.
 */
export declare const GENERATE_OUTFLOW_PERIODS_BUDGET: PerformanceBudget;
/**
 * Input for the generate outflow periods orchestrator.
 */
export interface GenerateOutflowPeriodsInput {
    outflow_id: string;
    outflow_data: Record<string, unknown>;
    user_id: string;
}
/**
 * Result from the generate outflow periods orchestrator.
 */
export interface GenerateOutflowPeriodsResult {
    success: boolean;
    periods_created: number;
    errors?: string[];
    trace_id: string;
}
/**
 * Orchestrator context for outflow period generation.
 */
export interface GenerateOutflowPeriodsContext extends TraceContext {
    input: GenerateOutflowPeriodsInput;
    idempotency_key: string;
}
/**
 * Generate outflow periods for a newly created outflow.
 *
 * This orchestrator:
 * 1. Resolves dependencies (outflow data + source periods)
 * 2. Computes outflow periods using domain service (PURE)
 * 3. Validates periods before persistence
 * 4. Saves periods to Firestore
 *
 * @param ctx - Orchestrator context with trace info and input
 * @returns Result with periods created count
 */
export declare function generate_outflow_periods_orchestrator(ctx: GenerateOutflowPeriodsContext): Promise<GenerateOutflowPeriodsResult>;
//# sourceMappingURL=generate_outflow_periods.orchestrator.d.ts.map