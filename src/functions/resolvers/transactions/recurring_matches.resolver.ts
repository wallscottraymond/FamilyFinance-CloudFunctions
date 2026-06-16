/**
 * Recurring Matches Resolver
 *
 * READ-ONLY: for a transaction, find which of its splits match a recurring bill
 * (outflow) or recurring income (inflow) — producing the `outflow_id` / `inflow_id`
 * the assignment engine puts on the split. Loads candidate periods in a window
 * around the transaction date and runs the pure `match_recurring` scorer per split.
 *
 * - `expense` transactions → outflow (bill) candidates → `outflow_id`
 * - `income` transactions  → inflow (income) candidates → `inflow_id`
 * - `transfer` → neither.
 *
 * Composite indexes: `outflow_periods(userId, firstDueDateInPeriod)`,
 * `inflow_periods(userId, firstDueDateInPeriod)`.
 *
 * @module resolvers/transactions/recurring_matches
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { outflow_period_repo } from "../../repositories/outflow_period.repo";
import { inflow_period_repo } from "../../repositories/inflow_period.repo";
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

function ms(value: unknown): number | null {
  return value instanceof Timestamp ? value.toMillis() : null;
}

/** Outflow (bill) period candidates around the transaction date. */
async function load_outflow_candidates(
  ctx: TraceContext,
  user_id: string,
  txn_date_ms: number
): Promise<RecurringCandidate[]> {
  const docs = await outflow_period_repo.get_in_due_window(
    ctx,
    user_id,
    txn_date_ms - WINDOW_MS,
    txn_date_ms + WINDOW_MS
  );
  return docs.map(({ id, data: d }) => {
    const meta = (d.metadata as Record<string, unknown>) ?? {};
    const splits_on_period = (d.transactionSplits as unknown[]) ?? [];
    return {
      period_id: id,
      recurring_id: d.outflowId as string,
      merchant_name:
        (d.merchantName as string | null) ??
        (meta.outflowMerchantName as string | null) ??
        null,
      // A single transaction settles ONE occurrence, so score against the
      // per-occurrence amount (fall back to the period total / amount due).
      expected_amount:
        (d.amountPerOccurrence as number) ??
        (d.expectedAmount as number) ??
        (d.totalAmountDue as number) ??
        0,
      due_date_ms: ms(d.firstDueDateInPeriod),
      is_settled: splits_on_period.length > 0,
    };
  });
}

/** Inflow (income) period candidates around the transaction date. */
async function load_inflow_candidates(
  ctx: TraceContext,
  user_id: string,
  txn_date_ms: number
): Promise<RecurringCandidate[]> {
  const docs = await inflow_period_repo.get_in_due_window(
    ctx,
    user_id,
    txn_date_ms - WINDOW_MS,
    txn_date_ms + WINDOW_MS
  );
  return docs.map(({ id, data: d }) => {
    const transaction_ids = (d.transactionIds as unknown[]) ?? [];
    return {
      period_id: id,
      recurring_id: d.inflowId as string,
      merchant_name:
        (d.merchant as string | null) ?? (d.payee as string | null) ?? null,
      expected_amount: (d.expectedAmount as number) ?? 0,
      due_date_ms: ms(d.firstDueDateInPeriod),
      is_settled: transaction_ids.length > 0,
    };
  });
}

/**
 * Resolve the recurring (bill/income) matches for a transaction's splits.
 *
 * @param txn_type - Transaction type: `expense` → outflows, `income` → inflows.
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

  const is_income = txn_type === "income";
  const is_expense = txn_type === "expense";
  if (!is_income && !is_expense) {
    return out; // transfers match nothing
  }

  const candidates = is_expense
    ? await load_outflow_candidates(ctx, user_id, txn_date_ms)
    : await load_inflow_candidates(ctx, user_id, txn_date_ms);

  if (candidates.length === 0) {
    return out;
  }

  for (const s of splits) {
    const result = match_recurring(
      {
        merchant_name: txn_merchant_name,
        // Match on magnitude so the amount score works regardless of the income
        // (negative) vs expense (positive) sign convention.
        amount: Math.abs(s.amount),
        date_ms: txn_date_ms,
      },
      candidates
    );
    if (result.matched) {
      out[s.split_id] = is_expense
        ? { outflow_id: result.recurring_id, inflow_id: null }
        : { outflow_id: null, inflow_id: result.recurring_id };
    }
  }

  return out;
}
