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
    return { periods: [], splits: [] };
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

  const periods: ResolvedReconciliationPeriod[] = period_docs
    .filter(({ data }) => data.isActive !== false)
    .map(({ id, data }) => {
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
      };
    });

  // 3. Linked payments from the doc's `transactionIds` MEMBERSHIP. Those are Plaid
  //    transaction ids (NOT Firestore doc ids), so load by `transactionId`. The
  //    membership IS the link — a listed transaction is a payment for this recurring
  //    item, regardless of whether the engine has stamped `split.outflow_id` yet.
  //    Each transaction contributes its net countable amount (one payment).
  const splits: ResolvedLinkedSplit[] = [];
  const user_id = (recurring as { user_id?: string }).user_id ?? "";
  const txns = await transaction_repo.get_by_plaid_transaction_ids(
    ctx,
    user_id,
    transaction_ids
  );
  for (const txn of txns) {
    if (txn.isActive === false) continue;
    const date_ms = to_ms(txn.transactionDate) ?? 0;
    const is_pending = txn.isPending === true;
    let amount = 0;
    let split_id = txn.id;
    for (const s of txn.splits ?? []) {
      if (s.isIgnored) continue;
      const magnitude = Math.abs(Number(s.amount ?? 0));
      amount += s.isRefund ? -magnitude : magnitude;
      if (s.splitId) split_id = s.splitId;
    }
    splits.push({ transaction_id: txn.id, split_id, amount, is_pending, date_ms });
  }

  console.log(
    `[${ctx.trace_id}] resolve_recurring_reconciliation: ${input.recurring_type}=${input.recurring_id}, ` +
      `active_periods=${periods.length}, linked_splits=${splits.length}`
  );

  return { periods, splits };
}
