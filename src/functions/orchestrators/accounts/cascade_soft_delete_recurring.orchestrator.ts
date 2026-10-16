/**
 * Cascade Soft Delete Recurring Orchestrator
 *
 * Job handler that soft-deletes all recurring outflows and inflows
 * for a removed account.
 *
 * @module orchestrators/accounts/cascade_soft_delete_recurring
 */

import {
  TraceContext,
  PerformanceBudget,
  create_performance_metrics,
} from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
  fire_and_forget,
  log_async_debug,
} from "../../observability";
import { outflow_repo } from "../../repositories/outflow.repo";
import { inflow_repo } from "../../repositories/inflow.repo";
import { outflow_period_repo } from "../../repositories/outflow_period.repo";
import { inflow_period_repo } from "../../repositories/inflow_period.repo";

/**
 * Performance budget for cascade operation.
 * Note: Used for documentation/reference, actual enforcement TBD.
 */
const _BUDGET: PerformanceBudget = {
  max_reads: 20,
  max_writes: 100,
  max_time_ms: 15000,
};
void _BUDGET; // Referenced for documentation

/**
 * Input for the cascade soft delete recurring job.
 */
export interface CascadeSoftDeleteRecurringInput {
  /** Plaid account ID */
  plaid_account_id: string;

  /** User ID */
  user_id: string;

  /** IDs of outflows to soft-delete */
  outflow_ids: string[];

  /** IDs of inflows to soft-delete */
  inflow_ids: string[];

  /** Trace ID from parent operation */
  trace_id: string;
}

/**
 * Result of the cascade operation.
 */
export interface CascadeSoftDeleteRecurringResult {
  /** Number of outflows soft-deleted */
  outflows_deleted: number;

  /** Number of inflows soft-deleted */
  inflows_deleted: number;

  /** Number of outflow periods soft-deleted */
  outflow_periods_deleted: number;

  /** Number of inflow periods soft-deleted */
  inflow_periods_deleted: number;

  /** Whether the operation completed successfully */
  success: boolean;
}

/**
 * Orchestrates soft-deleting recurring items for a removed account.
 *
 * This is designed to be idempotent - running multiple times
 * with the same input will produce the same result.
 *
 * @param ctx - Trace context
 * @param input - Job input
 * @returns Result with counts
 */
export async function cascade_soft_delete_recurring_orchestrator(
  ctx: TraceContext,
  input: CascadeSoftDeleteRecurringInput
): Promise<CascadeSoftDeleteRecurringResult> {
  const span = create_span(ctx, "orchestrator", "cascade_soft_delete_recurring");
  const perf = create_performance_metrics();
  log_operation_start(span, input.user_id);

  try {
    let outflows_deleted = 0;
    let inflows_deleted = 0;

    // Soft-delete outflows
    for (const outflow_id of input.outflow_ids) {
      try {
        // Check if already soft-deleted (idempotent)
        const outflow = await outflow_repo.get_by_id(ctx, outflow_id);
        perf.reads++;

        if (outflow && outflow.is_active) {
          await outflow_repo.soft_delete(ctx, outflow_id, input.user_id);
          perf.writes++;
          outflows_deleted++;
        }
      } catch (error) {
        // Log but continue with other outflows
        console.error(
          `[${ctx.trace_id}] Failed to soft-delete outflow ${outflow_id}:`,
          error
        );
      }
    }

    // Soft-delete inflows
    for (const inflow_id of input.inflow_ids) {
      try {
        // Check if already soft-deleted (idempotent)
        const inflow = await inflow_repo.get_by_id(ctx, inflow_id);
        perf.reads++;

        if (inflow && inflow.is_active) {
          await inflow_repo.soft_delete(ctx, inflow_id, input.user_id);
          perf.writes++;
          inflows_deleted++;
        }
      } catch (error) {
        // Log but continue with other inflows
        console.error(
          `[${ctx.trace_id}] Failed to soft-delete inflow ${inflow_id}:`,
          error
        );
      }
    }

    // Soft-delete the periods belonging to this account. Periods carry their own
    // `accountId`, so we deactivate by account in one shot (rather than per
    // recurring id) — this also catches periods whose parent was already
    // soft-deleted. Without this the periods stay `isActive: true` and keep
    // showing on the period views after the account is removed.
    const outflow_periods_deleted =
      await outflow_period_repo.set_active_by_account_id(
        ctx,
        input.plaid_account_id,
        false
      );
    const inflow_periods_deleted =
      await inflow_period_repo.set_active_by_account_id(
        ctx,
        input.plaid_account_id,
        false
      );
    perf.reads += 2;
    perf.writes += outflow_periods_deleted + inflow_periods_deleted;

    log_operation_success(span, input.user_id);

    // Async debug logging
    fire_and_forget(() =>
      log_async_debug({
        trace_id: ctx.trace_id,
        span_id: span.span_id,
        layer: "orchestrator",
        function: "cascade_soft_delete_recurring",
        status: "success",
        context: {
          plaid_account_id: input.plaid_account_id,
          outflows_deleted,
          inflows_deleted,
          outflow_periods_deleted,
          inflow_periods_deleted,
          outflows_requested: input.outflow_ids.length,
          inflows_requested: input.inflow_ids.length,
          perf_reads: perf.reads,
          perf_writes: perf.writes,
        },
      })
    );

    console.log(
      `[${ctx.trace_id}] cascade_soft_delete_recurring: ` +
      `outflows=${outflows_deleted}/${input.outflow_ids.length}, ` +
      `inflows=${inflows_deleted}/${input.inflow_ids.length}, ` +
      `outflow_periods=${outflow_periods_deleted}, inflow_periods=${inflow_periods_deleted}`
    );

    return {
      outflows_deleted,
      inflows_deleted,
      outflow_periods_deleted,
      inflow_periods_deleted,
      success: true,
    };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id: input.user_id, error_code: "CASCADE_SOFT_DELETE_RECURRING_FAILED" }
    );
    throw error;
  }
}
