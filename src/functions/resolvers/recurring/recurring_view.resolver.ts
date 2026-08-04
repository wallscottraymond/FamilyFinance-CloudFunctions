/**
 * Recurring View Resolver
 *
 * READ-ONLY dependency gathering for deriving a bill (recurring outflow) OR
 * income (recurring inflow) view on read (Derive-On-Read Period Architecture —
 * Phase 3). Both kinds share the schedule shape (frequency + anchor dates +
 * amount) and the same 3 pure primitives; only the repo + the split link field
 * differ. Fetches, bounded to the visible window:
 *   1. the item's SCHEDULE from its definition — the source of truth (the stored
 *      period docs are stale),
 *   2. the view's calendar buckets — `source_periods` of the requested cadence,
 *   3. the item's ACTUAL payments/receipts — transaction splits linked by
 *      `outflowId`/`inflowId` in the window.
 *
 * No generation/reconciliation/placement here (pure domain, run by the
 * orchestrator). No writes.
 *
 * @module resolvers/recurring/recurring_view
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { outflow_repo, inflow_repo, source_period_repo } from "../../repositories";
import { transaction_repo } from "../../repositories/transaction.repo";
import { PeriodInstanceType } from "../../domain/budgets";
import { RecurringScheduleForGeneration } from "../../domain/outflows/outflow_period.service";
import { PlacementBucket } from "../../domain/recurring/occurrence_placement.service";
import { ActualPayment } from "../../domain/recurring/reconcile_occurrences.service";

/** Which recurring stream: a bill (outflow) or income (inflow). */
export type RecurringKind = "outflow" | "inflow";

/** Everything the recurring-view derivation needs, gathered read-only. */
export interface RecurringViewDeps {
  name: string;
  schedule: RecurringScheduleForGeneration;
  buckets: PlacementBucket[];
  payments: ActualPayment[];
  /** The union span of the buckets (generation + payment fetch range), epoch ms. */
  span_start_ms: number;
  span_end_ms: number;
}

/** Resolve the item's schedule + display name + split link field, or null. */
async function resolve_source(
  ctx: TraceContext,
  user_id: string,
  kind: RecurringKind,
  recurring_id: string
): Promise<{ schedule: RecurringScheduleForGeneration; name: string; link_field: string } | null> {
  if (kind === "outflow") {
    const o = await outflow_repo.get_by_id(ctx, recurring_id);
    if (!o || o.user_id !== user_id) {
      return null;
    }
    return {
      schedule: {
        frequency: o.frequency,
        average_amount: o.average_amount,
        first_date: o.first_date,
        last_date: o.last_date,
        predicted_next_date: o.predicted_next_date,
      },
      name: o.user_custom_name || o.merchant_name || o.description || "Bill",
      link_field: "outflowId",
    };
  }
  const i = await inflow_repo.get_by_id(ctx, recurring_id);
  if (!i || i.user_id !== user_id) {
    return null;
  }
  return {
    schedule: {
      frequency: i.frequency,
      average_amount: i.average_amount,
      first_date: i.first_date,
      last_date: i.last_date,
      predicted_next_date: i.predicted_next_date,
    },
    name: i.user_custom_name || i.payer_name || i.description || "Income",
    link_field: "inflowId",
  };
}

/**
 * Gather the derivation inputs for `(kind, recurring_id, view_cadence, window)`.
 * Returns `null` when the item doesn't exist or isn't owned by the caller.
 */
export async function resolve_recurring_view_deps(
  ctx: TraceContext,
  user_id: string,
  kind: RecurringKind,
  recurring_id: string,
  view_cadence: PeriodInstanceType,
  window_start_ms: number,
  window_end_ms: number
): Promise<RecurringViewDeps | null> {
  const source = await resolve_source(ctx, user_id, kind, recurring_id);
  if (!source) {
    return null;
  }

  // 1. View buckets: source periods of the requested cadence overlapping the window.
  const overlapping = await source_period_repo.get_overlapping(
    ctx,
    Timestamp.fromMillis(window_start_ms),
    Timestamp.fromMillis(window_end_ms)
  );
  const buckets: PlacementBucket[] = overlapping
    .filter((p) => p.period_type === view_cadence)
    .map((p) => ({
      period_id: p.period_id,
      start_ms: p.start_date.toMillis(),
      end_ms: p.end_date.toMillis(),
    }));

  if (buckets.length === 0) {
    return {
      name: source.name,
      schedule: source.schedule,
      buckets: [],
      payments: [],
      span_start_ms: window_start_ms,
      span_end_ms: window_end_ms,
    };
  }

  const span_start_ms = Math.min(...buckets.map((b) => b.start_ms));
  const span_end_ms = Math.max(...buckets.map((b) => b.end_ms));

  // 2. Actual payments/receipts: splits linked to this item over the span.
  const txns = await transaction_repo.get_active_in_date_range(
    ctx,
    user_id,
    span_start_ms,
    span_end_ms
  );
  const payments: ActualPayment[] = [];
  for (const { id, data } of txns) {
    const txn_date_ms = (data.transactionDate as Timestamp).toMillis();
    const splits = (data.splits as Array<Record<string, unknown>>) ?? [];
    for (const s of splits) {
      if (s[source.link_field] !== recurring_id) {
        continue;
      }
      payments.push({
        transaction_id: id,
        split_id: (s.splitId as string) ?? (s.id as string) ?? null,
        date_ms: txn_date_ms,
        amount: Math.abs((s.amount as number) ?? 0),
      });
    }
  }

  return {
    name: source.name,
    schedule: source.schedule,
    buckets,
    payments,
    span_start_ms,
    span_end_ms,
  };
}
