/**
 * Reconcile User Recurring (debounced batch) Orchestrator
 *
 * Collapses the per-recurring reconcile fan-out (TR-3). Creating a recurring item used to
 * enqueue TWO durable jobs — `assign_recurring_transactions` + `reconcile_recurring_period`
 * — PER item, so a bulk import (or a Plaid recurring sync writing N streams) fanned out to
 * ~2N jobs + 2N `on_job_created` invocations, each re-resolving context.
 *
 * Instead, `on_{outflow,inflow}_created` now enqueues ONE debounced job per user (dedup
 * `reconcile_user_recurring:{uid}`). This job reads the user's watermark, finds every active
 * recurring (outflow + inflow) updated since it that has linked transactions, then: (1) runs
 * ONE `assign_transactions_batch` over the UNION of all dirty streams' transactions — a single
 * candidate preload instead of one per bill (the #1 read line); (2) reconciles each stream's
 * own periods. So N streams cost 1 job + 1 assignment scan. Counts are small (tens), no paging.
 *
 * Watermark advances to the max `updatedAt` of the items processed (never past an unprocessed
 * row). Per-item failures are caught + logged (a single poison stream must not strand the
 * rest); reconcile/assign are idempotent, so a re-run is safe.
 *
 * @module orchestrators/recurring/reconcile_user_recurring
 */

import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import { outflow_repo } from "../../repositories/outflow.repo";
import { inflow_repo } from "../../repositories/inflow.repo";
import { transaction_repo } from "../../repositories/transaction.repo";
import {
  get_recurring_reconcile_watermark_ms,
  set_recurring_reconcile_watermark_ms,
} from "../../repositories/recurring_reconcile_watermark.repo";
import {
  assign_transactions_batch_orchestrator,
} from "../transactions/assign_transactions_batch.orchestrator";
import {
  reconcile_recurring_periods_orchestrator,
} from "./reconcile_recurring_periods.orchestrator";
import { RecurringType } from "../../resolvers/recurring/period_reconciliation.resolver";

export interface ReconcileUserRecurringInput {
  user_id: string;
}

/** First-run lookback when no watermark exists — bounds the very first pass. */
const INITIAL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
/** How many recurring items to reconcile concurrently. */
const CONCURRENCY = 5;

interface DirtyRecurring {
  id: string;
  type: RecurringType;
  updated_ms: number;
  /** The stream's Plaid transaction ids (from the recurring doc). */
  plaid_ids: string[];
}

export async function reconcile_user_recurring_orchestrator(
  ctx: TraceContext,
  input: ReconcileUserRecurringInput
): Promise<{ reconciled: number }> {
  const span = create_span(ctx, "orchestrator", "reconcile_user_recurring");
  log_operation_start(span, input.user_id);

  try {
    const watermark_ms =
      (await get_recurring_reconcile_watermark_ms(input.user_id)) ??
      Date.now() - INITIAL_LOOKBACK_MS;

    // Read the user's active recurring ONCE (outflows + inflows). Counts are small.
    const [outflows, inflows] = await Promise.all([
      outflow_repo.get_by_user_id(ctx, input.user_id),
      inflow_repo.get_by_user_id(ctx, input.user_id),
    ]);

    // Dirty = updated since the watermark AND has linked transactions (mirrors the old
    // trigger guard — a stream with no txns has nothing to assign/reconcile).
    const dirty: DirtyRecurring[] = [];
    for (const o of outflows) {
      const ms = o.updated_at?.toMillis?.() ?? 0;
      if (ms > watermark_ms && (o.transaction_ids?.length ?? 0) > 0) {
        dirty.push({
          id: o.id, type: "outflow", updated_ms: ms, plaid_ids: o.transaction_ids ?? [],
        });
      }
    }
    for (const i of inflows) {
      const ms = i.updated_at?.toMillis?.() ?? 0;
      if (ms > watermark_ms && (i.transaction_ids?.length ?? 0) > 0) {
        dirty.push({
          id: i.id, type: "inflow", updated_ms: ms, plaid_ids: i.transaction_ids ?? [],
        });
      }
    }

    if (dirty.length === 0) {
      log_operation_success(span, input.user_id);
      return { reconciled: 0 };
    }

    // (1) ASSIGN once for the UNION of all dirty streams' transactions (TR-3 read fix).
    // Previously this looped `assign_recurring_transactions` per bill, and EACH call ran an
    // `assign_transactions_batch` whose candidate preload scans ALL of the user's
    // outflow_periods in the date span (~1.6K docs) — so M dirty bills = M full scans (the
    // #1 read line). Resolving the union of Plaid ids ONCE and running a SINGLE batch
    // collapses that to one candidate preload. The batch's per-split engine still links each
    // txn to its own matched stream, so correctness is unchanged.
    const union_plaid_ids = Array.from(new Set(dirty.flatMap((d) => d.plaid_ids)));
    if (union_plaid_ids.length > 0) {
      const txns = await transaction_repo.get_by_plaid_transaction_ids(
        ctx,
        input.user_id,
        union_plaid_ids
      );
      const doc_ids = txns.filter((t) => t.isActive !== false).map((t) => t.id);
      if (doc_ids.length > 0) {
        // Scope the candidate preload to just the dirty streams (read-cost #1): these txns ARE
        // those streams' membership, so the engine needs only their periods — not ALL the user's.
        await assign_transactions_batch_orchestrator(ctx, {
          user_id: input.user_id,
          transaction_ids: doc_ids,
          candidate_outflow_ids: dirty.filter((d) => d.type === "outflow").map((d) => d.id),
          candidate_inflow_ids: dirty.filter((d) => d.type === "inflow").map((d) => d.id),
        });
      }
    }

    // (2) RECONCILE each dirty stream's periods. This reads only that stream's OWN periods
    // (by outflowId/inflowId), NOT the user-wide candidate window — so it is not the #1 line.
    // Best-effort per item so one failure doesn't strand the rest.
    let reconciled = 0;
    const process_one = async (d: DirtyRecurring): Promise<void> => {
      try {
        await reconcile_recurring_periods_orchestrator(ctx, {
          recurring_id: d.id,
          recurring_type: d.type,
          user_id: input.user_id,
          trace_id: ctx.trace_id,
        });
        reconciled++;
      } catch (error) {
        console.error(
          `[${ctx.trace_id}] reconcile_user_recurring: ${d.type} ${d.id} failed`,
          error
        );
      }
    };
    for (let k = 0; k < dirty.length; k += CONCURRENCY) {
      await Promise.all(dirty.slice(k, k + CONCURRENCY).map(process_one));
    }

    // Advance to the max updatedAt among the items we looked at — never past an unprocessed
    // row (a stream created mid-run has a newer updatedAt and is caught by its own trigger).
    const max_ms = Math.max(...dirty.map((d) => d.updated_ms));
    await set_recurring_reconcile_watermark_ms(input.user_id, max_ms);

    console.log(
      `[${ctx.trace_id}] reconcile_user_recurring: user=${input.user_id} ` +
        `dirty=${dirty.length} reconciled=${reconciled} ` +
        `watermark=${new Date(max_ms).toISOString()}`
    );
    log_operation_success(span, input.user_id);
    return { reconciled };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id: input.user_id, error_code: "RECONCILE_USER_RECURRING_FAILED" }
    );
    throw error; // let the job queue retry from the un-advanced watermark
  }
}
