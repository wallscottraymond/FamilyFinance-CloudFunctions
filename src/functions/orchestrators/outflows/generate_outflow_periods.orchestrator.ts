/**
 * Generate Outflow Periods Orchestrator
 *
 * Coordinates the generation of outflow_period documents when a new outflow is created.
 * Follows the 5-layer architecture: Entry → Orchestrator → Resolver → Domain → Repository.
 *
 * @module orchestrators/outflows/generate_outflow_periods
 */

import {
  TraceContext,
  PerformanceBudget,
  PerformanceMetrics,
  create_performance_metrics,
  is_budget_exceeded,
  has_errors,
  get_entities,
} from "../../types";
import {
  create_span,
  create_child_span,
  SpanContext,
  log_operation_start,
  log_operation_success,
  log_operation_error,
  fire_and_forget,
  log_async_debug,
} from "../../observability";
import {
  resolve_outflow_period_dependencies_from_doc,
  OutflowPeriodDependencies,
} from "../../resolvers/outflows";
import {
  compute_outflow_periods,
  validate_outflow_periods,
} from "../../domain/outflows";
import { outflow_period_repo } from "../../repositories/outflow_period.repo";
import { batchUpdateUserPeriodSummariesFromOutflowPeriods } from "../../summaries/utils/batchUpdateUserPeriodSummaries";
import { Timestamp } from "firebase-admin/firestore";

/**
 * Performance budget for outflow period generation.
 * Generous limits since this is triggered by outflow creation.
 */
export const GENERATE_OUTFLOW_PERIODS_BUDGET: PerformanceBudget = {
  max_reads: 50,
  max_writes: 200, // Up to ~150 periods (3 types × 50 periods)
  max_time_ms: 10000, // 10 seconds
};

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
export async function generate_outflow_periods_orchestrator(
  ctx: GenerateOutflowPeriodsContext
): Promise<GenerateOutflowPeriodsResult> {
  const start_time = Date.now();
  const perf: PerformanceMetrics = create_performance_metrics();
  const errors: string[] = [];

  // Create span for this orchestrator
  const span: SpanContext = create_span(
    ctx,
    "orchestrator",
    "generate_outflow_periods"
  );

  log_operation_start(span, ctx.input.user_id);

  try {
    // 1. RESOLVE DEPENDENCIES
    const resolve_span: SpanContext = create_span(
      create_child_span(ctx),
      "resolver",
      "resolve_outflow_period_dependencies_from_doc"
    );

    let deps: OutflowPeriodDependencies;
    try {
      deps = await resolve_outflow_period_dependencies_from_doc(
        resolve_span,
        ctx.input.outflow_id,
        ctx.input.outflow_data
      );
      perf.reads += 1; // source_periods query
    } catch (error) {
      const err_msg = error instanceof Error ? error.message : String(error);
      errors.push(`Dependency resolution failed: ${err_msg}`);
      log_operation_error(resolve_span, new Error(err_msg));

      return {
        success: false,
        periods_created: 0,
        errors,
        trace_id: ctx.trace_id,
      };
    }

    // Guard: No source periods found
    if (deps.source_periods.length === 0) {
      console.warn(
        `[${ctx.trace_id}] generate_outflow_periods: No source periods found, skipping`
      );
      log_operation_success(span, ctx.input.user_id);
      return {
        success: true,
        periods_created: 0,
        trace_id: ctx.trace_id,
      };
    }

    console.log(
      `[${ctx.trace_id}] generate_outflow_periods: ${deps.source_periods.length} source periods`
    );

    // 2. COMPUTE OUTFLOW PERIODS (Domain Service - PURE)
    const now = Timestamp.now();
    const compute_result = compute_outflow_periods(
      deps.outflow,
      deps.source_periods,
      now
    );

    if (has_errors(compute_result)) {
      errors.push(...(compute_result.validation_errors ?? []));
      log_operation_error(span, new Error(errors.join("; ")));

      return {
        success: false,
        periods_created: 0,
        errors,
        trace_id: ctx.trace_id,
      };
    }

    const periods = get_entities(compute_result);
    console.log(
      `[${ctx.trace_id}] generate_outflow_periods: computed ${periods.length} periods`
    );

    // 3. VALIDATE PERIODS (Domain Service - PURE)
    const validation_result = validate_outflow_periods(periods);

    if (has_errors(validation_result)) {
      errors.push(...(validation_result.validation_errors ?? []));
      log_operation_error(span, new Error(errors.join("; ")));

      return {
        success: false,
        periods_created: 0,
        errors,
        trace_id: ctx.trace_id,
      };
    }

    // 4. PERSIST PERIODS (Repository)
    const persist_span: SpanContext = create_span(
      create_child_span(ctx),
      "repository",
      "outflow_period_repo.save_batch"
    );

    const write_result = await outflow_period_repo.save_batch(
      persist_span,
      periods,
      ctx.input.user_id
    );

    perf.writes += write_result.count;

    // 5. UPDATE USER PERIOD SUMMARIES (Mirror legacy behavior)
    // This ensures the frontend receives updated summary data
    if (write_result.count > 0) {
      const period_ids = periods.map((p) => p.id);
      console.log(
        `[${ctx.trace_id}] generate_outflow_periods: updating summaries for ${period_ids.length} periods`
      );

      try {
        const summaries_updated = await batchUpdateUserPeriodSummariesFromOutflowPeriods(
          ctx.input.user_id,
          period_ids
        );
        console.log(
          `[${ctx.trace_id}] generate_outflow_periods: updated ${summaries_updated} summaries`
        );
        perf.writes += summaries_updated;
      } catch (summary_error) {
        // Non-fatal: log but don't fail the orchestrator
        console.error(
          `[${ctx.trace_id}] generate_outflow_periods: summary update failed (non-fatal):`,
          summary_error
        );
      }
    }

    // 6. CHECK PERFORMANCE BUDGET
    perf.time_ms = Date.now() - start_time;
    if (is_budget_exceeded(perf, GENERATE_OUTFLOW_PERIODS_BUDGET)) {
      console.warn(
        `[${ctx.trace_id}] generate_outflow_periods: Performance budget exceeded`,
        { perf, budget: GENERATE_OUTFLOW_PERIODS_BUDGET }
      );
    }

    // 7. LOG SUCCESS
    log_operation_success(span, ctx.input.user_id);

    console.log(
      `[${ctx.trace_id}] generate_outflow_periods: created ${write_result.count} periods ` +
      `from ${deps.source_periods.length} source periods in ${perf.time_ms}ms`
    );

    // 8. ASYNC DEBUG LOGGING
    fire_and_forget(() =>
      log_async_debug({
        trace_id: ctx.trace_id,
        span_id: span.span_id,
        layer: span.layer,
        function: span.function,
        status: "success",
        inputs: {
          outflow_id: ctx.input.outflow_id,
          source_period_count: deps.source_periods.length,
        },
        output: {
          periods_created: write_result.count,
        },
        performance: perf,
      })
    );

    return {
      success: true,
      periods_created: write_result.count,
      trace_id: ctx.trace_id,
    };
  } catch (error) {
    const err_msg = error instanceof Error ? error.message : String(error);
    errors.push(`Orchestrator failed: ${err_msg}`);
    log_operation_error(span, error instanceof Error ? error : new Error(err_msg));

    return {
      success: false,
      periods_created: 0,
      errors,
      trace_id: ctx.trace_id,
    };
  }
}
