/**
 * Period Reconciliation Resolver (Recurring-Period-Reconciliation Phase 3c)
 *
 * READ-ONLY. Loads everything the pure domain needs to reconcile a recurring
 * doc's periods: the recurring doc (for its `transactionIds` inbound list + the
 * variable-amount flag), its ACTIVE periods, and the linked splits.
 *
 * ⚠️ Honors the domain CONTRACT: `amount` is sign-normalized so positive =
 * toward paid/received (refunds negative). Ignored splits are excluded.
 *
 * @module resolvers/recurring/period_reconciliation
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { outflow_repo } from "../../repositories/outflow.repo";
import { inflow_repo } from "../../repositories/inflow.repo";
import { outflow_period_repo } from "../../repositories/outflow_period.repo";
import { inflow_period_repo } from "../../repositories/inflow_period.repo";
import { transaction_repo } from "../../repositories/transaction.repo";
import { compute_countable_split_net } from "../../domain/recurring/period_reconciliation.service";
import { RemovalInterval } from "../../domain/recurring/recurring_suppression.service";
import { bill_release_schedule, is_payment_released } from "../../domain/recurring/late_payment.service";
import {
  is_edge_money,
  is_manual_period_pin,
  splits_paying_recurring,
} from "../../domain/recurring/stream_membership";
import { fingerprint_stored } from "../../domain/recurring/reconciliation_fingerprint";
import { ManualSettledOccurrences } from "../../domain/recurring/manual_settlement.service";

export type RecurringType = "outflow" | "inflow";

/** Period data the domain needs (alignment + reconciliation). */
export interface ResolvedReconciliationPeriod {
  period_id: string;
  start_ms: number;
  end_ms: number;
  due_date_ms: number | null;
  /** Expected amount of a SINGLE occurrence (domain recomputes the period total). */
  amount_per_occurrence: number;
  /** Expected occurrence due dates (epoch ms); domain self-corrects to [start,end]. */
  occurrence_due_dates_ms: number[];
  is_variable_amount: boolean;
  /** "monthly" | "weekly" | "bi_monthly" — periods of all types overlap in time. */
  period_type: string;
  /** Fingerprint of the stored reconciliation (null = never reconciled) — unchanged → no write. */
  stored_fingerprint: string | null;
  /** D28: active only because it holds an early payment carried from a removed month. */
  carry_active?: boolean;
}

/** A linked split, sign-normalized, with its date for alignment. */
export interface ResolvedLinkedSplit {
  transaction_id: string;
  split_id: string;
  amount: number; // signed: positive toward paid/received, refunds negative
  is_pending: boolean;
  date_ms: number;
}

export interface ResolvedReconciliation {
  periods: ResolvedReconciliationPeriod[];
  splits: ResolvedLinkedSplit[];
  /** "Mark as paid / received" marks on the definition (applied by the shared rule). */
  manual_marks: ManualSettledOccurrences;
  /** D28: the item's INACTIVE periods (an early payment may carry into one) — only loaded data,
   *  no extra read; empty when the item has no removal intervals. */
  inactive_periods?: ResolvedReconciliationPeriod[];
  removal_intervals?: RemovalInterval[];
}

export interface ResolveReconciliationInput {
  recurring_id: string;
  recurring_type: RecurringType;
}

function to_ms(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof (value as Timestamp).toMillis === "function") {
    return (value as Timestamp).toMillis();
  }
  return null;
}

/**
 * Whether a recurring item has a VARIABLE amount (utilities, commission, hourly):
 * an explicit `is_variable_amount` flag if present, else derived from the spread
 * between its last and average occurrence amounts (>10% swing ⇒ variable). Variable
 * items reconcile presence-based (any payment), fixed items amount-based.
 */
function derive_is_variable_amount(recurring: {
  is_variable_amount?: boolean;
  last_amount?: number;
  average_amount?: number;
}): boolean {
  if (typeof recurring.is_variable_amount === "boolean") {
    return recurring.is_variable_amount;
  }
  const last = recurring.last_amount ?? 0;
  const avg = recurring.average_amount ?? 0;
  if (avg <= 0) return false;
  return Math.abs(last - avg) > 0.1 * avg;
}

export async function resolve_recurring_reconciliation(
  ctx: TraceContext,
  input: ResolveReconciliationInput
): Promise<ResolvedReconciliation> {
  const is_outflow = input.recurring_type === "outflow";

  // 1. Recurring doc → inbound transaction list + variable flag.
  const recurring = is_outflow
    ? await outflow_repo.get_by_id(ctx, input.recurring_id, { include_deleted: true })
    : await inflow_repo.get_by_id(ctx, input.recurring_id, { include_deleted: true });
  if (!recurring) {
    return { periods: [], splits: [], manual_marks: {} };
  }
  const transaction_ids: string[] = recurring.transaction_ids ?? [];
  const is_variable_amount = derive_is_variable_amount(recurring);
  // Fallback per-occurrence amount when a period lacks `amountPerOccurrence`.
  const recurring_amount =
    (recurring as { average_amount?: number; last_amount?: number; amount?: number })
      .average_amount ??
    (recurring as { last_amount?: number }).last_amount ??
    (recurring as { amount?: number }).amount ??
    0;

  // 2. Active periods (load ids → docs → filter active in memory; no composite index).
  const period_ids = is_outflow
    ? await outflow_period_repo.get_by_outflow_id(ctx, input.recurring_id)
    : await inflow_period_repo.get_by_inflow_id(ctx, input.recurring_id);
  const period_docs =
    period_ids.length === 0
      ? []
      : is_outflow
        ? await outflow_period_repo.get_by_ids(ctx, period_ids)
        : await inflow_period_repo.get_by_ids(ctx, period_ids);

  const to_period = ({ id, data }: { id: string; data: Record<string, unknown> }): ResolvedReconciliationPeriod => {
    const per_occurrence = Number(data.amountPerOccurrence ?? 0) || recurring_amount;
    let due_dates_ms = Array.isArray(data.occurrenceDueDates)
      ? data.occurrenceDueDates
        .map((d: unknown) => to_ms(d))
        .filter((d: number | null): d is number => d !== null)
      : [];
      // Fallback for legacy periods missing the array: a single occurrence at the
      // period's due date (the domain still filters to [start,end]). Regeneration
      // backfills the real array; this just covers the transitional window.
    if (due_dates_ms.length === 0) {
      const due = to_ms(data.firstDueDateInPeriod);
      if (due !== null) due_dates_ms = [due];
    }
    return {
      period_id: id,
      start_ms: to_ms(data.periodStartDate) ?? 0,
      end_ms: to_ms(data.periodEndDate) ?? 0,
      due_date_ms: to_ms(data.firstDueDateInPeriod),
      amount_per_occurrence: per_occurrence,
      occurrence_due_dates_ms: due_dates_ms,
      is_variable_amount,
      period_type: String(data.periodType ?? ""),
      stored_fingerprint: fingerprint_stored(data.reconciliation),
      ...(data.carryActive === true ? { carry_active: true } : {}),
    };
  };
  const periods: ResolvedReconciliationPeriod[] = period_docs.filter(({ data }) => data.isActive !== false).map(to_period);
  const removal_intervals_all = (recurring as { removal_intervals?: RemovalInterval[] }).removal_intervals;
  // Round 5 defect 5: only a LIVE item carries (a stale / stopped / hidden one shows nowhere on the
  // period page — nothing of it may be turned on).
  const record_live =
    (recurring as { is_active?: boolean }).is_active !== false && (recurring as { is_hidden?: boolean }).is_hidden !== true;
  const inactive_periods: ResolvedReconciliationPeriod[] = removal_intervals_all?.length && record_live
    ? period_docs.filter(({ data }) => data.isActive === false).map(to_period)
    : [];

  // Period-pin support (Bill-Assignment-Two-Stage-Picker): a split that pins a specific period
  // pays THAT period's occurrence — it's placed on the DUE DATE of the bill's first occurrence in
  // the pinned period (so every cadence's period containing that due date sees it paid, as the
  // period page matches it), else the period's midpoint when nothing is due there.
  const midpoint_by_source_period = new Map<string, number>();
  for (const { data } of period_docs) {
    const sp = data.sourcePeriodId as string | undefined;
    const s = to_ms(data.periodStartDate);
    const e = to_ms(data.periodEndDate);
    if (sp && s !== null && e !== null) {
      const dues = ((data.occurrenceDueDates as unknown[] | undefined) ?? [])
        .map((d) => to_ms(d))
        .filter((ms): ms is number => ms !== null && ms >= s && ms <= e)
        .sort((a, b) => a - b);
      const first_due = dues[0] ?? to_ms(data.firstDueDateInPeriod);
      midpoint_by_source_period.set(
        sp,
        first_due !== null && first_due >= s && first_due <= e ? first_due : Math.floor((s + e) / 2)
      );
    }
  }

  // 3. Linked payments — UNION of two sources, deduped by Firestore doc id:
  //    (a) the DURABLE split link (`splitOutflowIds`/`splitInflowIds`, stamped by
  //        the assignment engine) — survives Plaid's id reissue on pending→posted;
  //        this is the primary, current source.
  //    (b) the recurring's Plaid stream `transactionIds[]` membership — legacy /
  //        covers items the engine hasn't stamped yet. Can be STALE (Plaid lags),
  //        so it's a supplement, not the source of truth.
  //    Each transaction contributes its net countable amount (one payment).
  const splits: ResolvedLinkedSplit[] = [];
  const user_id = (recurring as { user_id?: string }).user_id ?? "";
  const [link_txns, stream_txns] = await Promise.all([
    transaction_repo.get_by_split_recurring_link(
      ctx,
      user_id,
      input.recurring_type,
      input.recurring_id
    ),
    transaction_repo.get_by_plaid_transaction_ids(ctx, user_id, transaction_ids),
  ]);
  const seen = new Set<string>();
  // Per SPLIT (the period page's rule — `splits_paying_recurring`): the splits linked to this
  // recurring, else (stream member) the splits not taken off by a "remove from bill" / a budget
  // pin. A transaction with no paying split isn't a payment.
  const kind = is_outflow ? "outflow" : "inflow";
  const stream_ids = new Set(stream_txns.map((t) => t.id));
  // Edge money (a transfer crossing the view) pays nothing — as the period page drops its links.
  const paying = (t: { id: string; splits?: unknown[] }) =>
    is_edge_money((t as { transferRole?: unknown }).transferRole)
      ? []
      : splits_paying_recurring(
        t.splits ?? [],
        kind,
        input.recurring_id,
        stream_ids.has(t.id)
      );
  const txns = [...link_txns, ...stream_txns].filter((t) => {
    const key = t.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return paying(t).length > 0;
  });
  // A payment in a month the bill / income is removed / paused for pays nothing — it counts as
  // ordinary spending / money in (X9; the engine and the period page apply the same rule).
  const removal_intervals = (recurring as { removal_intervals?: RemovalInterval[] })
    .removal_intervals;
  const release_schedule = is_outflow && removal_intervals?.length
    ? bill_release_schedule(recurring as Parameters<typeof bill_release_schedule>[0])
    : null;
  // D31 / D37: the bill's payments, as the release rule judges a late payment by them.
  const release_bill = release_schedule
    ? {
      schedule: release_schedule,
      payments: txns.filter((t) => t.isActive !== false).map((t) => ({
        id: t.id,
        date_ms: to_ms(t.transactionDate) ?? 0,
        amount: compute_countable_split_net(paying(t) as Parameters<typeof compute_countable_split_net>[0], t.id).amount,
      })),
    }
    : null;
  for (const txn of txns) {
    if (txn.isActive === false) continue;
    // D31 / D37: except a bill's LATE payment of its last occurrence before the cut-off while
    // that occurrence is still unpaid.
    if (is_payment_released(removal_intervals, { id: txn.id, date_ms: to_ms(txn.transactionDate) ?? 0 }, release_bill)) continue;
    // Honor a manual PERIOD PIN for THIS outflow: align by the pinned period's midpoint
    // (forces placement into that period) instead of the transaction date.
    let date_ms = to_ms(txn.transactionDate) ?? 0;
    if (is_outflow) {
      const pinned = (txn.splits ?? []).find((s) => {
        const sp = s as { outflowId?: string | null; outflowPinnedPeriodId?: string };
        return sp.outflowId === input.recurring_id && is_manual_period_pin(sp);
      }) as { outflowPinnedPeriodId?: string } | undefined;
      const pinned_source = pinned?.outflowPinnedPeriodId;
      if (pinned_source && midpoint_by_source_period.has(pinned_source)) {
        date_ms = midpoint_by_source_period.get(pinned_source)!;
      }
    }
    const is_pending = txn.isPending === true;
    // Net countable amount (ignore/refund math) — computed in the domain service
    // so the resolver stays lookup-only (P2-11).
    const { amount, split_id } = compute_countable_split_net(
      paying(txn) as Parameters<typeof compute_countable_split_net>[0],
      txn.id
    );
    splits.push({ transaction_id: txn.id, split_id, amount, is_pending, date_ms });
  }

  console.log(
    `[${ctx.trace_id}] resolve_recurring_reconciliation: ${input.recurring_type}=${input.recurring_id}, ` +
      `active_periods=${periods.length}, linked_splits=${splits.length}`
  );

  return {
    periods, splits, manual_marks: recurring.manual_settled_occurrences ?? {},
    ...(removal_intervals_all?.length ? { inactive_periods, removal_intervals: removal_intervals_all } : {}),
  };
}
