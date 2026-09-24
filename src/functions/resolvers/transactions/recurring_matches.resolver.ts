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

/** Map a raw outflow_period doc → bill candidate (pure). */
function to_outflow_candidate(id: string, d: Record<string, unknown>): RecurringCandidate {
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
}

/** Map a raw inflow_period doc → income candidate (pure). */
function to_inflow_candidate(id: string, d: Record<string, unknown>): RecurringCandidate {
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
}

/**
 * Bill + income candidate periods loaded ONCE for a whole assign-batch (covering
 * [window_start_ms, window_end_ms]) instead of per transaction. `resolve_recurring_matches`
 * filters these to each transaction's ±90d window in memory, so the matched result is
 * IDENTICAL to loading per-transaction — this only removes the repeated
 * `outflow_periods`/`inflow_periods` reads (the top Firestore read line).
 */
export interface PreloadedRecurringCandidates {
  outflow_candidates: RecurringCandidate[];
  inflow_candidates: RecurringCandidate[];
  window_start_ms: number;
  window_end_ms: number;
}

/**
 * Load ALL bill + income candidate periods due in [start_ms, end_ms] ONCE (for the batch path).
 * These are the same two queries the per-transaction path runs — executed a single time.
 */
export async function load_recurring_candidates(
  ctx: TraceContext,
  user_id: string,
  start_ms: number,
  end_ms: number
): Promise<PreloadedRecurringCandidates> {
  const [outflow_docs, inflow_docs] = await Promise.all([
    outflow_period_repo.get_in_due_window(ctx, user_id, start_ms, end_ms),
    inflow_period_repo.get_in_due_window(ctx, user_id, start_ms, end_ms),
  ]);
  return {
    outflow_candidates: outflow_docs.map(({ id, data }) => to_outflow_candidate(id, data)),
    inflow_candidates: inflow_docs.map(({ id, data }) => to_inflow_candidate(id, data)),
    window_start_ms: start_ms,
    window_end_ms: end_ms,
  };
}

/**
 * Load candidate periods SCOPED to a known set of outflow/inflow ids (read-cost #1). Same shape
 * as `load_recurring_candidates`, but instead of scanning ALL of a user's due periods it reads
 * only the given streams' periods in [start_ms, end_ms]. Correct for the recurring-reconcile
 * assign path: its txns ARE these streams' membership, so single-split txns resolve via the
 * authoritative stream map and multi-split scoring only ever needs its own stream's occurrences.
 * `window_start/end` stay the true batch span so `candidates_for_txn`'s coverage check passes
 * (never falling back to a per-txn full scan).
 */
export async function load_recurring_candidates_scoped(
  ctx: TraceContext,
  outflow_ids: string[],
  inflow_ids: string[],
  start_ms: number,
  end_ms: number
): Promise<PreloadedRecurringCandidates> {
  const [outflow_docs, inflow_docs] = await Promise.all([
    outflow_period_repo.get_in_due_window_for_ids(ctx, outflow_ids, start_ms, end_ms),
    inflow_period_repo.get_in_due_window_for_ids(ctx, inflow_ids, start_ms, end_ms),
  ]);
  return {
    outflow_candidates: outflow_docs.map(({ id, data }) => to_outflow_candidate(id, data)),
    inflow_candidates: inflow_docs.map(({ id, data }) => to_inflow_candidate(id, data)),
    window_start_ms: start_ms,
    window_end_ms: end_ms,
  };
}

/** Outflow (bill) period candidates around the transaction date (per-transaction fallback). */
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
  return docs.map(({ id, data }) => to_outflow_candidate(id, data));
}

/** Inflow (income) period candidates around the transaction date (per-transaction fallback). */
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
  return docs.map(({ id, data }) => to_inflow_candidate(id, data));
}

/**
 * Candidates for a transaction: reuse the batch-preloaded set (filtered to the txn's ±90d
 * window — identical to a fresh query) when it fully covers that window; otherwise fall back
 * to a per-transaction query (e.g. a historical date outside the preloaded window).
 */
async function candidates_for_txn(
  ctx: TraceContext,
  user_id: string,
  is_expense: boolean,
  txn_date_ms: number,
  preloaded?: PreloadedRecurringCandidates
): Promise<RecurringCandidate[]> {
  const lo = txn_date_ms - WINDOW_MS;
  const hi = txn_date_ms + WINDOW_MS;
  if (preloaded && lo >= preloaded.window_start_ms && hi <= preloaded.window_end_ms) {
    const all = is_expense ? preloaded.outflow_candidates : preloaded.inflow_candidates;
    return all.filter((c) => c.due_date_ms != null && c.due_date_ms >= lo && c.due_date_ms <= hi);
  }
  return is_expense
    ? load_outflow_candidates(ctx, user_id, txn_date_ms)
    : load_inflow_candidates(ctx, user_id, txn_date_ms);
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
  splits: Array<{ split_id: string; amount: number }>,
  opts: {
    /** The transaction's Plaid id — matched against the recurring streams' `transactionIds`. */
    txn_plaid_id?: string | null;
    outflow_tx_to_id?: Map<string, string>;
    inflow_tx_to_id?: Map<string, string>;
    /** Batch-preloaded candidate periods (loaded once per batch) — avoids the per-txn query. */
    preloaded_candidates?: PreloadedRecurringCandidates;
  } = {}
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

  // 0. AUTHORITATIVE deterministic link: if this transaction is a member of a recurring
  //    stream (its Plaid id is in the def's `transactionIds`) and the txn has a SINGLE
  //    split, link that split directly. Plaid's own stream membership beats the fuzzy
  //    merchant/amount scorer, which misses empty-merchant bills / stale periods (the S1
  //    root cause). Multi-split txns fall through to per-split fuzzy matching (don't guess
  //    which split is the bill). No stream match → fuzzy fallback below.
  const stream_map = is_expense ? opts.outflow_tx_to_id : opts.inflow_tx_to_id;
  if (opts.txn_plaid_id && stream_map && splits.length === 1) {
    const recurring_id = stream_map.get(opts.txn_plaid_id);
    if (recurring_id) {
      out[splits[0].split_id] = is_expense
        ? { outflow_id: recurring_id, inflow_id: null }
        : { outflow_id: null, inflow_id: recurring_id };
      return out;
    }
  }

  const candidates = await candidates_for_txn(
    ctx,
    user_id,
    is_expense,
    txn_date_ms,
    opts.preloaded_candidates
  );

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
