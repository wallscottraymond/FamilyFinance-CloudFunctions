/**
 * Recurring Matches Resolver
 *
 * READ-ONLY: for a transaction, find which of its splits match a recurring bill
 * (outflow) — producing the `outflow_id` the assignment engine puts on the
 * split. Loads candidate outflow periods in a window around the transaction
 * date and runs the pure `match_recurring` scorer per split.
 *
 * Inflow (income) matching is deferred to Recurring-Period-Reconciliation (the
 * inflow-period reconciliation is new); `inflow_id` stays null for now.
 *
 * Composite index: `outflow_periods(userId ASC, expectedDueDate ASC)`.
 *
 * @module resolvers/transactions/recurring_matches
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { outflow_period_repo } from "../../repositories/outflow_period.repo";
import {
  match_recurring,
  RecurringCandidate,
} from "../../domain/transactions/match_recurring.service";

const WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // ±90 days candidate window

/** Per-split recurring links keyed by split id (the engine's `recurring_by_split`). */
export type RecurringBySplit = Record<
  string,
  { outflow_id: string | null; inflow_id: string | null }
>;

/**
 * Resolve the recurring (bill) matches for a transaction's splits.
 *
 * @param splits - The splits (split_id + amount) to match
 * @param txn_type - Transaction type; only `expense` matches outflows
 */
export async function resolve_recurring_matches(
  ctx: TraceContext,
  user_id: string,
  txn_type: string,
  txn_merchant_name: string | null,
  txn_date_ms: number,
  splits: Array<{ split_id: string; amount: number }>
): Promise<RecurringBySplit> {
  const out: RecurringBySplit = {};
  for (const s of splits) {
    out[s.split_id] = { outflow_id: null, inflow_id: null };
  }

  // Only expenses match bills (transfers/income don't).
  if (txn_type !== "expense") {
    return out;
  }

  // Load candidate outflow periods in a window around the transaction date.
  const period_docs = await outflow_period_repo.get_in_due_window(
    ctx,
    user_id,
    txn_date_ms - WINDOW_MS,
    txn_date_ms + WINDOW_MS
  );

  const candidates: RecurringCandidate[] = period_docs.map(({ id, data: d }) => {
    const meta = (d.metadata as Record<string, unknown>) ?? {};
    const splits_on_period = (d.transactionSplits as unknown[]) ?? [];
    return {
      period_id: id,
      recurring_id: d.outflowId as string,
      merchant_name:
        (d.merchantName as string | null) ??
        (meta.outflowMerchantName as string | null) ??
        null,
      expected_amount: (d.amountDue as number) ?? 0,
      due_date_ms: d.expectedDueDate
        ? (d.expectedDueDate as Timestamp).toMillis()
        : null,
      is_settled: splits_on_period.length > 0,
    };
  });

  if (candidates.length === 0) {
    return out;
  }

  for (const s of splits) {
    const result = match_recurring(
      { merchant_name: txn_merchant_name, amount: s.amount, date_ms: txn_date_ms },
      candidates
    );
    if (result.matched) {
      out[s.split_id] = { outflow_id: result.recurring_id, inflow_id: null };
    }
  }
  return out;
}
