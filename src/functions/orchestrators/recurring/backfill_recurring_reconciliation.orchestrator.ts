/**
 * Backfill Recurring Reconciliation Orchestrator
 * (Recurring-Period-Reconciliation Phase 7)
 *
 * Self-fanning coordinator (one job type):
 *   - no `user_id` → enumerate users, enqueue one per-user `backfill_recurring_reconciliation`.
 *   - with `user_id` → enqueue a `reconcile_recurring_period` per ACTIVE recurring
 *     outflow + inflow for that user.
 *
 * Reuses the Phase 3 reconcile job (idempotent) — safe to re-run.
 *
 * @module orchestrators/recurring/backfill_recurring_reconciliation
 */

import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import { create_job } from "../../infrastructure/job_queue";
import { outflow_repo } from "../../repositories/outflow.repo";
import { inflow_repo } from "../../repositories/inflow.repo";
import { resolve_backfill_user_ids } from "../../resolvers/transactions/backfill_targets.resolver";

export interface BackfillRecurringReconciliationInput {
  /** Backfill one user; omit to fan out to all users. */
  user_id?: string;
  /**
   * When true, first REGENERATE each recurring doc's period occurrence data (via the
   * correct v2 generator) before reconciling — fixes legacy periods missing/with
   * stale occurrence data. Each per-doc `regenerate_recurring_occurrences` job
   * enqueues its own reconcile. When false (default), reconcile directly.
   */
  regenerate?: boolean;
}

export interface BackfillRecurringReconciliationResult {
  mode: "fan_out_users" | "user";
  users_enqueued?: number;
  reconciles_enqueued?: number;
}

export async function backfill_recurring_reconciliation_orchestrator(
  ctx: TraceContext,
  input: BackfillRecurringReconciliationInput
): Promise<BackfillRecurringReconciliationResult> {
  const span = create_span(ctx, "orchestrator", "backfill_recurring_reconciliation");
  log_operation_start(span, input.user_id ?? "ALL");

  try {
    // Fan out per user.
    if (!input.user_id) {
      const user_ids = await resolve_backfill_user_ids(ctx);
      for (const user_id of user_ids) {
        await create_job(
          "backfill_recurring_reconciliation",
          { user_id, regenerate: input.regenerate },
          { trace_id: ctx.trace_id }
        );
      }
      console.log(
        `[${ctx.trace_id}] backfill_recurring_reconciliation: fanned out ${user_ids.length} users`
      );
      log_operation_success(span, "ALL");
      return { mode: "fan_out_users", users_enqueued: user_ids.length };
    }

    // Per user → one job per active recurring doc. `regenerate` re-derives occurrence
    // data first (each regen job enqueues its own reconcile); otherwise reconcile.
    const outflows = await outflow_repo.get_by_user_id(ctx, input.user_id);
    const inflows = await inflow_repo.get_by_user_id(ctx, input.user_id);
    const job_type = input.regenerate
      ? "regenerate_recurring_occurrences"
      : "reconcile_recurring_period";
    let enqueued = 0;

    for (const o of outflows) {
      await create_job(
        job_type,
        {
          recurring_id: o.id,
          recurring_type: "outflow",
          user_id: input.user_id,
          trace_id: ctx.trace_id,
        },
        { trace_id: ctx.trace_id }
      );
      enqueued++;
    }
    for (const i of inflows) {
      await create_job(
        job_type,
        {
          recurring_id: i.id,
          recurring_type: "inflow",
          user_id: input.user_id,
          trace_id: ctx.trace_id,
        },
        { trace_id: ctx.trace_id }
      );
      enqueued++;
    }

    console.log(
      `[${ctx.trace_id}] backfill_recurring_reconciliation: user=${input.user_id}, ` +
        `outflows=${outflows.length}, inflows=${inflows.length}`
    );
    log_operation_success(span, input.user_id);
    return { mode: "user", reconciles_enqueued: enqueued };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      {
        user_id: input.user_id ?? "ALL",
        error_code: "BACKFILL_RECURRING_RECONCILIATION_FAILED",
      }
    );
    throw error;
  }
}
