/**
 * Budget Spend Domain Service
 *
 * Pure, invalidation-based computation of a budget period's spent amount from the
 * transaction splits assigned to it. Spent is RECOMPUTED from the current splits
 * (never incremented), so it can't drift.
 *
 * Rules (from the spend-pipeline design):
 * - A split counts toward a budget period when it is assigned to that budget AND
 *   the transaction date is within the period's range AND it is "countable".
 * - **Countable** excludes: transfers, `ignored` splits, and recurring-mapped
 *   splits (`outflow_id`/`inflow_id` set — the recurring system tracks those).
 * - **`refund` splits stay countable** (you paid → still in `spent`), but their
 *   |amount| ALSO accrues into a parallel `return_amount` = the user's *expected*
 *   returns (Split-Status-Actions). `return_amount` does NOT reduce `spent`; the UI
 *   derives net = `spent − return_amount`. (A real negative Plaid credit is a
 *   separate posted txn that nets `spent` down on its own.)
 * - The FULL split amount counts in EVERY overlapping period (the caller invokes
 *   this once per period; each period is an independent view).
 * - `pending_spent` is the pending-transaction portion of `spent`.
 *
 * NO async, NO IO, NO side effects. Time injected as epoch ms.
 *
 * @module domain/budgets/budget_spend
 */

import { FeeKind, FeeSpend, PlaceSpend, SpendBreakdownAccumulator } from "./spend_breakdown.service";

/** A split's budget-spend treatment (mirrors the `SpendStatus` type). */
export type SpendStatusForSpend = "counted" | "ignored" | "refund";

/** A split + its transaction context, as the spend computation needs it. */
export interface SplitForSpend {
  budget_id: string;
  amount: number;
  txn_date_ms: number;
  /** Transaction-level: pending vs posted. */
  is_pending: boolean;
  /** Transaction-level: an internal transfer (excluded from budget spend). */
  is_transfer: boolean;
  /** Transaction-level: a credit (`type: "income"`). Real income is excluded via
   *  `is_income_category`; a credit in an EXPENSE category is a one-off return that
   *  reverses (reduces) spent. */
  is_income: boolean;
  /** Effective category is a Plaid `INCOME_*` category ⇒ real income, not a purchase
   *  return — excluded from budget spend entirely (belongs to inflows). */
  is_income_category: boolean;
  /** Effective category is a Plaid `TRANSFER_IN_*`/`TRANSFER_OUT_*` category ⇒ money
   *  movement (own accounts / savings / investments / withdrawals), NOT spending — so
   *  it's excluded from budget spend (incl. Everything-Else). This catches transfers
   *  that the internal matched-pair `is_transfer` flag missed (external / unpaired).
   *  Optional: callers without category context omit it (defaults to not-excluded). */
  is_transfer_category?: boolean;
  /** Split-level spend treatment (resolver derives it from spendStatus/legacy flags). */
  spend_status: SpendStatusForSpend;
  /** Recurring links — present ⇒ tracked by the recurring system, excluded here. */
  outflow_id: string | null;
  inflow_id: string | null;
  /** Transaction belongs to a recurring bill/income Plaid stream (by `transactionIds`),
   *  even if this split's `outflow_id`/`inflow_id` link was never populated. Excludes
   *  the split from budget spend so an unlinked bill payment doesn't double-count as
   *  spending (S5). Optional: callers without stream context omit it (defaults false). */
  is_recurring_member?: boolean;
  /** Spend breakdown only (never a counting decision): the transaction's vendor key
   *  (domain/transactions/vendor_key — stored `vendorKey`, else computed from its names), its
   *  display name, and its bank-fee kind when the category is a BANK_FEES one. Optional. */
  vendor_key?: string | null;
  place_name?: string | null;
  fee_kind?: FeeKind | null;
}

/** Computed spend for one budget period. */
export interface BudgetSpendResult {
  spent: number;
  pending_spent: number;
  /** Σ|amount| of the countable `refund` splits — expected returns (parallel to spent). */
  return_amount: number;
  /** Only when `daily` is requested: `spent` per UTC calendar day of the period (index 0 = the
   *  period's first day). Same splits + sign as `spent`; Σ daily_spent === spent to the cent. */
  daily_spent?: number[];
  /** Only when `daily` is requested: purchases per day (splits that ADD spend; a refund credit is
   *  not one), indexed as `daily_spent`. */
  daily_count?: number[];
  /** Only when `daily` is requested: the counted spend by place, top TOP_PLACES by total. */
  places?: PlaceSpend[];
  /** Only when `daily` is requested: bank fees among the counted spend, by kind (present kinds). */
  fees?: FeeSpend[];
}

/** Which days to break `spent` into: the period's first day (epoch ms) and its day count. */
export interface DailySpendWindow {
  start_ms: number;
  days: number;
}

const DAY_MS = 86_400_000;

// Plaid category semantics (transfer/income) live in the transactions domain so
// the routing engine and this read-time calc share ONE definition. Re-exported
// here for the existing budget read-path imports.
export {
  is_transfer_category,
  is_income_category,
} from "../transactions/category_semantics.service";

/**
 * Whether a split counts toward budget `spent`. Excludes transfers (both the internal
 * matched-pair flag AND the Plaid TRANSFER_* category — so external/unpaired transfers
 * don't leak into Everything-Else), real income, ignored splits, and recurring-linked
 * (bill/income) splits. `refund` and one-off income returns stay countable (the latter
 * reverse spend — see compute_budget_spent). PURE.
 */
export function is_countable(split: SplitForSpend): boolean {
  return (
    !split.is_transfer &&
    !split.is_transfer_category &&
    !split.is_income_category &&
    split.spend_status !== "ignored" &&
    split.outflow_id === null &&
    split.inflow_id === null &&
    !split.is_recurring_member
  );
}

/** Round to 2 decimals. PURE. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Recompute a budget period's spent + pending_spent from the splits.
 *
 * @param budget_id - The budget owning this period
 * @param period_start_ms - Period start (inclusive), epoch ms
 * @param period_end_ms - Period end (inclusive), epoch ms
 * @param splits - Candidate splits (any budget; this filters to `budget_id`)
 * @param daily - Optional: also break `spent` into UTC days (Budget daily chart) and the spend
 *   breakdown (purchases per day, places, bank fees — the "Easy to change" tips). Accumulated in
 *   this same loop so none of it can drift from `spent`.
 *
 * PURE FUNCTION.
 */
export function compute_budget_spent(
  budget_id: string,
  period_start_ms: number,
  period_end_ms: number,
  splits: SplitForSpend[],
  daily?: DailySpendWindow
): BudgetSpendResult {
  let spent = 0;
  let pending = 0;
  let return_amount = 0;
  const day_count = daily ? Math.max(0, daily.days) : 0;
  const by_day: number[] | null = daily ? new Array<number>(day_count).fill(0) : null;
  const first_day = daily ? Math.floor(daily.start_ms / DAY_MS) : 0;
  const count_by_day: number[] | null = daily ? new Array<number>(day_count).fill(0) : null;
  const breakdown = daily ? new SpendBreakdownAccumulator() : null;

  for (const split of splits) {
    if (split.budget_id !== budget_id) {
      continue;
    }
    if (split.txn_date_ms < period_start_ms || split.txn_date_ms > period_end_ms) {
      continue;
    }
    if (!is_countable(split)) {
      continue;
    }
    // A one-off income return (a credit in an expense category, e.g. an item
    // refund) comes in positive and REVERSES that portion of spend. Everything
    // else adds. Amounts are stored positive; direction comes from `is_income`.
    const magnitude = Math.abs(split.amount);
    const signed = split.is_income ? -magnitude : split.amount;
    spent += signed;
    if (by_day && day_count > 0) {
      // UTC day index; clamp so a split inside the period always lands somewhere.
      const idx = Math.floor(split.txn_date_ms / DAY_MS) - first_day;
      const day = Math.min(day_count - 1, Math.max(0, idx));
      by_day[day] += signed;
      // A purchase = a split that ADDS spend (a credit netting it down isn't one).
      if (count_by_day && signed > 0) count_by_day[day] += 1;
    }
    breakdown?.add(split, signed);
    if (split.is_pending) {
      pending += signed;
    }
    // Refund splits and income returns accrue their magnitude as an expected return.
    if (split.is_income || split.spend_status === "refund") {
      return_amount += magnitude;
    }
  }

  const spent_rounded = round2(spent);
  return {
    spent: spent_rounded,
    pending_spent: round2(pending),
    return_amount: round2(return_amount),
    ...(by_day ? { daily_spent: round_days_to_total(by_day, spent_rounded) } : {}),
    ...(count_by_day ? { daily_count: count_by_day } : {}),
    ...(breakdown ? { places: breakdown.top_places(), fees: breakdown.fee_list() } : {}),
  };
}

/**
 * Round each day to cents, then put the rounding remainder on the last non-zero day so the days
 * sum EXACTLY to `total` (the already-rounded `spent`). PURE.
 */
export function round_days_to_total(raw: number[], total: number): number[] {
  const days = raw.map((v) => round2(v) + 0); // `+ 0` turns -0 into 0
  if (days.length === 0) return days;
  const cents_off = Math.round(total * 100) - days.reduce((sum, v) => sum + Math.round(v * 100), 0);
  if (cents_off !== 0) {
    let last = days.length - 1;
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i] !== 0) {
        last = i;
        break;
      }
    }
    days[last] = (Math.round(days[last] * 100) + cents_off) / 100 + 0;
  }
  return days;
}

/**
 * A stored split's spend status — THE one reading (the period page, stored spend and every other
 * reader): explicit `spendStatus` wins, else the legacy `isIgnored` / `isRefund` booleans, else
 * "counted". PURE.
 */
export function split_spend_status(split: Record<string, unknown>): "counted" | "ignored" | "refund" {
  const status = split.spendStatus;
  if (status === "counted" || status === "ignored" || status === "refund") return status;
  return split.isIgnored === true ? "ignored" : split.isRefund === true ? "refund" : "counted";
}

