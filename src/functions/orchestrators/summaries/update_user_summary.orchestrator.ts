/**
 * Update User Summary Orchestrator
 *
 * Coordinates the update of user period summaries following the 5-layer architecture:
 * Entry → Orchestrator → Resolver → Domain → Repository
 *
 * @module orchestrators/summaries/update_user_summary
 */

import { Timestamp } from "firebase-admin/firestore";
import {
  TraceContext,
  PerformanceBudget,
  PerformanceMetrics,
  create_performance_metrics,
  is_budget_exceeded,
  has_errors,
} from "../../types";
import {
  create_span,
  SpanContext,
  log_operation_start,
  log_operation_success,
  log_operation_error,
  fire_and_forget,
  log_async_debug,
} from "../../observability";
import {
  resolve_outflow_periods_for_summary,
  resolve_inflow_periods_for_summary,
  resolve_budget_periods_for_summary,
} from "../../resolvers/summaries";
import {
  compute_user_period_summary,
  validate_user_period_summary,
} from "../../domain/summaries";
import { user_summary_repo, TransactionDependencies } from "../../repositories/user_summary.repo";
import { create_job_if_not_exists } from "../../infrastructure/job_queue";

// ============================================================================
// PERFORMANCE BUDGET
// ============================================================================

/**
 * Performance budget for user summary update.
 */
export const UPDATE_USER_SUMMARY_BUDGET: PerformanceBudget = {
  max_reads: 10, // 1 source period + 3 resource collections
  max_writes: 1, // 1 summary document
  max_time_ms: 3000, // 3 seconds
};

// ============================================================================
// INPUT/OUTPUT TYPES
// ============================================================================

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

// ============================================================================
// SINGLE SUMMARY UPDATE ORCHESTRATOR
// ============================================================================

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
export async function update_user_summary_orchestrator(
  ctx: UpdateUserSummaryContext
): Promise<UpdateUserSummaryResult> {
  const start_time = Date.now();
  const perf: PerformanceMetrics = create_performance_metrics();
  const errors: string[] = [];

  // Create span for this orchestrator
  const span: SpanContext = create_span(
    ctx,
    "orchestrator",
    "update_user_summary"
  );

  log_operation_start(span, ctx.input.user_id);

  // Build summary ID
  const normalized_period_type = ctx.input.period_type.toLowerCase();
  const summary_id = `${ctx.input.user_id}_${normalized_period_type}_${ctx.input.source_period_id}`;

  let final_summary_id: string | null = null;
  let outflow_count = 0;
  let budget_count = 0;
  let inflow_count = 0;

  try {
    // Use transactional save to prevent race conditions
    // The transaction will:
    // 1. Read the existing summary (establishes conflict detection)
    // 2. Read all dependent period documents
    // 3. Compute the new summary with fresh data
    // 4. Write atomically
    // If the summary changes between read and write, Firestore retries automatically

    await user_summary_repo.save_with_transaction(
      ctx,
      summary_id,
      ctx.input.user_id,
      ctx.input.source_period_id,
      ctx.input.period_type,
      (deps: TransactionDependencies) => {
        // Track counts for logging
        outflow_count = deps.outflow_periods.length;
        budget_count = deps.budget_periods.length;
        inflow_count = deps.inflow_periods.length;

        // COMPUTE SUMMARY (Domain Service - PURE)
        const now = Timestamp.now();
        const compute_result = compute_user_period_summary({
          user_id: ctx.input.user_id,
          source_period: deps.source_period,
          outflow_periods: deps.outflow_periods,
          budget_periods: deps.budget_periods,
          inflow_periods: deps.inflow_periods,
          now,
        });

        if (has_errors(compute_result)) {
          throw new Error(compute_result.validation_errors?.join("; ") ?? "Compute failed");
        }

        const summary = compute_result.entity!;

        // VALIDATE SUMMARY (Domain Service - PURE)
        const validation_result = validate_user_period_summary(summary);

        if (has_errors(validation_result)) {
          throw new Error(validation_result.validation_errors?.join("; ") ?? "Validation failed");
        }

        final_summary_id = summary.id;
        return summary;
      }
    );

    perf.reads += 4; // 1 summary + 1 source period + 3 resource queries (inside transaction)
    perf.writes += 1;

    // CHECK PERFORMANCE BUDGET
    perf.time_ms = Date.now() - start_time;
    if (is_budget_exceeded(perf, UPDATE_USER_SUMMARY_BUDGET)) {
      console.warn(
        `[${ctx.trace_id}] update_user_summary: Performance budget exceeded`,
        { perf, budget: UPDATE_USER_SUMMARY_BUDGET }
      );
    }

    // LOG SUCCESS (structured span only — per-job console line removed for volume)
    log_operation_success(span, ctx.input.user_id);

    // ASYNC DEBUG LOGGING
    fire_and_forget(() =>
      log_async_debug({
        trace_id: ctx.trace_id,
        span_id: span.span_id,
        layer: span.layer,
        function: span.function,
        status: "success",
        inputs: ctx.input,
        output: {
          summary_id: final_summary_id,
          outflow_count,
          budget_count,
          inflow_count,
        },
        performance: perf,
      })
    );

    return {
      success: true,
      summary_id: final_summary_id,
      trace_id: ctx.trace_id,
    };
  } catch (error) {
    const err_msg = error instanceof Error ? error.message : String(error);
    errors.push(`Orchestrator failed: ${err_msg}`);
    log_operation_error(span, error instanceof Error ? error : new Error(err_msg));

    return {
      success: false,
      summary_id: null,
      errors,
      trace_id: ctx.trace_id,
    };
  }
}

/**
 * Shared graph node: enqueue one deduplicated `update_user_summary` job per
 * affected (period_type, source_period_id) pair.
 *
 * This is the SINGLE entry point through which every summary-affecting change
 * (inflow, outflow, budget — whether from a generation cascade or a period
 * trigger) flows. Each job is processed by the `update_user_summary`
 * orchestrator, whose transactional repository recomputes the summary from all
 * sources. The deduplication key collapses redundant updates for the same
 * summary while one is already pending, preventing overlap.
 *
 * @param ctx - Trace context
 * @param user_id - The user ID
 * @param periods_by_type - Map of period_type → set of source_period_ids
 * @returns Count of jobs enqueued (excludes deduplicated no-ops)
 */
async function enqueue_summary_update_jobs(
  ctx: TraceContext,
  user_id: string,
  periods_by_type: Map<string, Set<string>>
): Promise<number> {
  let enqueued = 0;

  for (const [period_type, source_period_ids] of periods_by_type.entries()) {
    const normalized_period_type = period_type.toLowerCase();
    for (const source_period_id of source_period_ids) {
      const deduplication_key =
        `${user_id}_${normalized_period_type}_${source_period_id}`;

      const job = await create_job_if_not_exists(
        "update_user_summary",
        {
          user_id,
          period_type,
          source_period_id,
          deduplication_key,
        },
        { trace_id: ctx.trace_id }
      );

      if (job) {
        enqueued += 1;
      }
    }
  }

  return enqueued;
}

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
export async function enqueue_user_summary_updates_by_type(
  ctx: TraceContext,
  user_id: string,
  periods_by_type: Map<string, Set<string>>
): Promise<number> {
  const enqueued = await enqueue_summary_update_jobs(ctx, user_id, periods_by_type);
  console.log(
    `[${ctx.trace_id}] enqueue_user_summary_updates_by_type: ` +
      `enqueued ${enqueued} summary jobs`
  );
  return enqueued;
}

/**
 * Enqueue user-summary update jobs for the given outflow periods.
 * Graph-oriented: routes through the shared `update_user_summary` job node.
 *
 * @param ctx - Trace context
 * @param user_id - The user ID
 * @param outflow_period_ids - Array of outflow_period document IDs
 * @returns Count of jobs enqueued
 */
export async function enqueue_user_summary_updates_from_outflow_periods(
  ctx: TraceContext,
  user_id: string,
  outflow_period_ids: string[]
): Promise<number> {
  const { periods_by_type } = await resolve_outflow_periods_for_summary(
    ctx,
    outflow_period_ids
  );
  const enqueued = await enqueue_summary_update_jobs(ctx, user_id, periods_by_type);

  console.log(
    `[${ctx.trace_id}] enqueue_user_summary_updates_from_outflow_periods: ` +
      `enqueued ${enqueued} summary jobs`
  );

  return enqueued;
}

// ============================================================================
// CONVENIENCE FUNCTION FOR INFLOW PERIOD UPDATES
// ============================================================================

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
export async function enqueue_user_summary_updates_from_inflow_periods(
  ctx: TraceContext,
  user_id: string,
  inflow_period_ids: string[]
): Promise<number> {
  const { periods_by_type } = await resolve_inflow_periods_for_summary(
    ctx,
    inflow_period_ids
  );
  const enqueued = await enqueue_summary_update_jobs(ctx, user_id, periods_by_type);

  console.log(
    `[${ctx.trace_id}] enqueue_user_summary_updates_from_inflow_periods: ` +
      `enqueued ${enqueued} summary jobs`
  );

  return enqueued;
}

// ============================================================================
// CONVENIENCE FUNCTION FOR BUDGET PERIOD UPDATES
// ============================================================================

/**
 * Enqueue user-summary update jobs for the given budget periods.
 * Graph-oriented: routes through the shared `update_user_summary` job node.
 *
 * @param ctx - Trace context
 * @param user_id - The user ID
 * @param budget_period_ids - Array of budget_period document IDs
 * @returns Count of jobs enqueued
 */
export async function enqueue_user_summary_updates_from_budget_periods(
  ctx: TraceContext,
  user_id: string,
  budget_period_ids: string[]
): Promise<number> {
  const { periods_by_type } = await resolve_budget_periods_for_summary(
    ctx,
    budget_period_ids
  );
  const enqueued = await enqueue_summary_update_jobs(ctx, user_id, periods_by_type);

  console.log(
    `[${ctx.trace_id}] enqueue_user_summary_updates_from_budget_periods: ` +
      `enqueued ${enqueued} summary jobs`
  );

  return enqueued;
}
