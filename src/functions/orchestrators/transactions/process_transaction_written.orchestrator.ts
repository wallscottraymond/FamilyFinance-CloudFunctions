/**
 * Process Transaction Written Orchestrator
 *
 * The control-flow brain behind the `on_transaction_written` trigger. Given a
 * transaction's before/after snapshots, it decides what async work to enqueue:
 *
 *   • DELETE          → recompute the budgets the gone splits referenced.
 *   • assignment edit → re-run the assignment engine (which fans out its own
 *                       recompute for the budgets it touches).
 *   • spend-only edit → recompute directly (assign would skip, since the
 *                       assignment didn't move).
 *
 * Relevance is decided by the pure field-guard (domain). Jobs are enqueued with
 * a per-event deduplication key so trigger replays of the SAME write collapse to
 * one job; genuine subsequent writes (new event id) still enqueue.
 *
 * @module orchestrators/transactions/process_transaction_written
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
} from "../../observability";
import { create_job_if_not_exists } from "../../infrastructure/job_queue";
import {
  is_assignment_relevant_change,
  is_spend_relevant_change,
} from "../../domain/transactions/assignment_field_guard.service";

/** Input: the written transaction's snapshots + the triggering event id. */
export interface ProcessTransactionWrittenInput {
  transaction_id: string;
  user_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** Firestore event id — seeds the per-event job deduplication keys. */
  event_id: string;
}

/**
 * Distinct budget ids referenced by a transaction's splits (the denormalized
 * `splitBudgetIds` if present, else mapped off the splits array), excluding the
 * `unassigned` sentinel. Used to scope recompute fan-out.
 */
function budget_ids_from_doc(doc: Record<string, unknown>): string[] {
  const denorm = doc.splitBudgetIds as string[] | undefined;
  const ids = denorm
    ? denorm
    : ((doc.splits as Array<Record<string, unknown>> | undefined) ?? [])
      .map((s) => s.budgetId as string | undefined)
      .filter((id): id is string => !!id);
  return Array.from(new Set(ids)).filter((id) => id !== "unassigned");
}

/**
 * Distinct recurring-outflow / -inflow ids the doc's splits are linked to (from the
 * denormalized `splitOutflowIds`/`splitInflowIds`, else mapped off the splits). Used
 * to refresh recurring reconciliation when a linked transaction changes — notably
 * pending→posted, which the stream `transactionIds[]` misses.
 */
function recurring_links_from_doc(
  doc: Record<string, unknown>
): { outflow_ids: string[]; inflow_ids: string[] } {
  const splits = (doc.splits as Array<Record<string, unknown>> | undefined) ?? [];
  const out =
    (doc.splitOutflowIds as string[] | undefined) ??
    splits.map((s) => s.outflowId as string | undefined).filter((id): id is string => !!id);
  const inf =
    (doc.splitInflowIds as string[] | undefined) ??
    splits.map((s) => s.inflowId as string | undefined).filter((id): id is string => !!id);
  return {
    outflow_ids: Array.from(new Set(out)),
    inflow_ids: Array.from(new Set(inf)),
  };
}

/**
 * Enqueue a deduplicated `reconcile_recurring_period` job for every recurring
 * outflow/inflow the transaction's splits touch across `before ∪ after`. Deduped
 * per (recurring, event) so trigger replays collapse; routed through the guarded
 * job queue (no per-write cascade).
 */
async function enqueue_recurring_reconciles(
  ctx: TraceContext,
  user_id: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  event_id: string
): Promise<void> {
  const b = recurring_links_from_doc(before ?? {});
  const a = recurring_links_from_doc(after ?? {});
  const outflow_ids = Array.from(new Set([...b.outflow_ids, ...a.outflow_ids]));
  const inflow_ids = Array.from(new Set([...b.inflow_ids, ...a.inflow_ids]));

  for (const recurring_id of outflow_ids) {
    await create_job_if_not_exists(
      "reconcile_recurring_period",
      {
        deduplication_key: `reconcile:outflow:${recurring_id}:${event_id}`,
        recurring_id,
        recurring_type: "outflow",
        user_id,
      },
      { trace_id: ctx.trace_id }
    );
  }
  for (const recurring_id of inflow_ids) {
    await create_job_if_not_exists(
      "reconcile_recurring_period",
      {
        deduplication_key: `reconcile:inflow:${recurring_id}:${event_id}`,
        recurring_id,
        recurring_type: "inflow",
        user_id,
      },
      { trace_id: ctx.trace_id }
    );
  }
}

export async function process_transaction_written_orchestrator(
  ctx: TraceContext,
  input: ProcessTransactionWrittenInput
): Promise<void> {
  const span = create_span(ctx, "orchestrator", "process_transaction_written");
  log_operation_start(span, input.user_id);

  const { transaction_id, user_id, before, after, event_id } = input;
  const recompute_key = `recompute:${transaction_id}:${event_id}`;

  // DELETE: the doc is gone, so `assign_transaction` (which reads it) can't
  // discover the touched budgets. Recompute directly from the `before` snapshot
  // — recompute is invalidation-based, so the gone splits drop out of the query.
  if (!after && before) {
    const budget_ids = budget_ids_from_doc(before);
    const txn_date = before.transactionDate as Timestamp | undefined;
    if (budget_ids.length > 0 && txn_date) {
      await create_job_if_not_exists(
        "recompute_budget_spent",
        {
          deduplication_key: recompute_key,
          user_id,
          budget_ids,
          transaction_date_ms: txn_date.toMillis(),
        },
        { trace_id: ctx.trace_id }
      );
    }
    // Also refresh any recurring items the deleted transaction was paying.
    await enqueue_recurring_reconciles(ctx, user_id, before, null, event_id);
    log_operation_success(span, user_id);
    return;
  }

  const assignment_relevant = is_assignment_relevant_change(before, after);
  const spend_relevant = is_spend_relevant_change(before, after);

  // Cosmetic edit (notes/tags/description) — nothing to do.
  if (!assignment_relevant && !spend_relevant) {
    log_operation_success(span, user_id);
    return;
  }

  // Assignment change (category / budget pin / split add-remove): re-run
  // assignment, which fans out a recompute for the budgets it touches.
  if (assignment_relevant) {
    await create_job_if_not_exists(
      "assign_transaction",
      {
        deduplication_key: `assign:${transaction_id}:${event_id}`,
        user_id,
        transaction_id,
      },
      { trace_id: ctx.trace_id }
    );
  }

  // Spend-only change (split amount, isIgnored, pending→posted, date) that
  // doesn't move the assignment — assign skips its recompute, so trigger one
  // directly for the affected budgets (before ∪ after splits).
  if (spend_relevant && after) {
    const budget_ids = [
      ...new Set([
        ...budget_ids_from_doc(before ?? {}),
        ...budget_ids_from_doc(after),
      ]),
    ];
    const txn_date = after.transactionDate as Timestamp | undefined;
    if (budget_ids.length > 0 && txn_date) {
      await create_job_if_not_exists(
        "recompute_budget_spent",
        {
          deduplication_key: recompute_key,
          user_id,
          budget_ids,
          transaction_date_ms: txn_date.toMillis(),
        },
        { trace_id: ctx.trace_id }
      );
    }
  }

  // Recurring reconciliation refresh: when a transaction linked to a bill/income
  // changes (notably pending→posted, which the stream `transactionIds[]` misses),
  // recompute that recurring's periods so paid/received + the pending flag update.
  // before ∪ after so an UN-link also reverts the previously-linked item.
  await enqueue_recurring_reconciles(ctx, user_id, before, after, event_id);

  log_operation_success(span, user_id);
}
