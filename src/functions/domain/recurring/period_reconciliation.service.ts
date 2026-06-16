/**
 * Period Reconciliation Domain Service
 *
 * Pure logic for the Recurring-Period-Reconciliation project's Phase 3:
 *   1. `align_transaction_to_period` — which period a matched transaction belongs to
 *      (HYBRID: date-in-range, with nearest-due-date as the boundary tiebreak).
 *   2. `compute_period_reconciliation` — a period's paid/received status, recomputed
 *      invalidation-style from its currently-linked splits.
 *
 * Serves BOTH outflow (bill "paid") and inflow (income "received") periods — the
 * caller passes the right periods/splits; the logic is identical.
 *
 * NO async, NO IO, NO side effects. Dates injected as epoch ms.
 *
 * @module domain/recurring/period_reconciliation
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// 1. ALIGN TRANSACTION → PERIOD  (hybrid date-in-range + nearest-due-date)
// ============================================================================

/** A period a transaction might be aligned to. */
export interface PeriodForAlignment {
  period_id: string;
  /** Period date range (inclusive). */
  start_ms: number;
  end_ms: number;
  /** The occurrence's expected due date; null if the period has none. */
  due_date_ms: number | null;
}

/** Tunable windows for the hybrid rule. */
export interface AlignmentOptions {
  /**
   * Gap fallback: when the txn falls in NO period's range, assign to the period
   * whose due-date is nearest within this window. Decided value = half the period
   * length (auto-scales per frequency).
   */
  tolerance_ms: number;
  /**
   * Boundary override: when the txn IS inside a period's range but lands within
   * this (small) window BEFORE an adjacent period's due date, treat it as an early
   * autopay for that NEXT period. Keep small (~ a few days) so a LATE payment
   * (well past its own due date) stays in its containing period.
   */
  early_window_ms: number;
}

export type AlignmentReason =
  | "in_range"
  | "early_autopay_next"
  | "nearest_due_date"
  | "no_match";

export interface AlignmentResult {
  period_id: string | null;
  reason: AlignmentReason;
}

/**
 * Pick the period a transaction belongs to.
 *
 * Rule:
 *  - Containing period (date-in-range) wins by default → a late payment stays put.
 *  - Override to an adjacent period whose due date is within `early_window_ms`
 *    AHEAD of the txn (early autopay across the boundary).
 *  - No containing period (a gap between generated periods) → nearest due date
 *    within `tolerance_ms`, else no match.
 *
 * PURE FUNCTION.
 */
export function align_transaction_to_period(
  txn_date_ms: number,
  periods: PeriodForAlignment[],
  opts: AlignmentOptions
): AlignmentResult {
  if (periods.length === 0) {
    return { period_id: null, reason: "no_match" };
  }

  // Sort once for deterministic tie-breaking across all branches.
  const sorted = [...periods].sort((a, b) => a.start_ms - b.start_ms);

  // Containing period (date-in-range). If overlapping ranges somehow exist, the
  // earliest by start wins — deterministic.
  const containing = sorted.find(
    (p) => txn_date_ms >= p.start_ms && txn_date_ms <= p.end_ms
  );

  // Early-autopay override: a period whose due date is just AHEAD of the txn.
  let early_best: PeriodForAlignment | null = null;
  let early_best_gap = Infinity;
  for (const p of sorted) {
    if (p.due_date_ms === null) continue;
    const ahead = p.due_date_ms - txn_date_ms; // >0 ⇒ due date is in the future
    if (ahead > 0 && ahead <= opts.early_window_ms && ahead < early_best_gap) {
      // Don't override to the containing period itself.
      if (!containing || p.period_id !== containing.period_id) {
        early_best = p;
        early_best_gap = ahead;
      }
    }
  }

  if (containing) {
    if (early_best) {
      return { period_id: early_best.period_id, reason: "early_autopay_next" };
    }
    return { period_id: containing.period_id, reason: "in_range" };
  }

  // No containing period → nearest due date within tolerance.
  let nearest: PeriodForAlignment | null = null;
  let nearest_dist = Infinity;
  for (const p of sorted) {
    if (p.due_date_ms === null) continue;
    const dist = Math.abs(p.due_date_ms - txn_date_ms);
    if (dist <= opts.tolerance_ms && dist < nearest_dist) {
      nearest = p;
      nearest_dist = dist;
    }
  }
  if (nearest) {
    return { period_id: nearest.period_id, reason: "nearest_due_date" };
  }

  return { period_id: null, reason: "no_match" };
}

/** Convenience: half the period length, the decided gap tolerance. */
export function default_tolerance_ms(period_start_ms: number, period_end_ms: number): number {
  return Math.max(0, (period_end_ms - period_start_ms) / 2);
}

/** Cap on the early-autopay override window. */
export const MAX_EARLY_WINDOW_MS = 5 * DAY_MS;

/**
 * Decided early-autopay override window, SCALED to the period so it stays small
 * relative to short (weekly) periods — otherwise a normal mid-week payment would
 * be mis-filed as an early payment for the next week. = min(5 days, ¼ period).
 */
export function default_early_window_ms(
  period_start_ms: number,
  period_end_ms: number
): number {
  return Math.min(MAX_EARLY_WINDOW_MS, Math.max(0, (period_end_ms - period_start_ms) * 0.25));
}

// ============================================================================
// 2. COMPUTE PERIOD RECONCILIATION  (status from currently-linked splits)
// ============================================================================

/** The period fields reconciliation reads. */
export interface PeriodForReconciliation {
  period_id: string;
  /** Period date range — used to SELF-CORRECT occurrence dates (filter to range). */
  start_ms: number;
  end_ms: number;
  /** Variable-amount item (utilities/commission/hourly): an occurrence is satisfied
   *  by ANY net-positive payment; fixed items also require the amount to be met. */
  is_variable_amount: boolean;
  /** Expected amount of a SINGLE occurrence (Plaid average/last amount). */
  amount_per_occurrence: number;
  /** Expected occurrence due dates (epoch ms) from Plaid frequency. May contain
   *  out-of-range dates (legacy gen bug); the domain filters to [start,end]. */
  occurrence_due_dates_ms: number[];
}

/**
 * A payment currently linked to this period (a transaction in the recurring doc's
 * `transactionIds`). ⚠️ CONTRACT: the RESOLVER sign-normalizes `amount` (positive =
 * toward paid/received, refunds negative) and supplies `date_ms` (payment date, for
 * occurrence assignment).
 */
export interface LinkedSplit {
  transaction_id: string;
  split_id: string;
  amount: number;
  is_pending: boolean;
  date_ms: number;
}

export type ReconciliationStatus = "none" | "partial" | "complete" | "over";

/** Per-occurrence detail — which of the period's expected payments landed. */
export interface OccurrenceStatus {
  due_date_ms: number;
  paid: boolean;
  transaction_id: string | null;
  amount: number | null;
}

export interface ReconciliationResult {
  period_id: string;
  status: ReconciliationStatus;
  /** Posted net amount (refunds subtracted). */
  matched_amount: number;
  /** Pending-only amount (tracked separately; does NOT flip status). */
  pending_amount: number;
  /** Recomputed = occurrences_expected × amount_per_occurrence (self-corrected). */
  expected_amount: number;
  /** Occurrences the period expects (self-corrected to its date range). */
  occurrences_expected: number;
  /** Occurrences with a posted payment assigned. */
  occurrences_paid: number;
  /** Per-occurrence detail (count + which transaction). */
  occurrences: OccurrenceStatus[];
  matched_splits: LinkedSplit[];
}

/** Currency epsilon (half a cent) for amount comparisons. */
const AMOUNT_EPSILON = 0.005;

/**
 * Compute a period's reconciliation status, OCCURRENCE-AWARE: a period can expect
 * multiple payments (a weekly bill in a monthly view, or income paid twice a month).
 * Tracks BOTH the occurrence count (N of M) and the dollar amount.
 *
 * Self-correcting: occurrence due dates are filtered to the period's [start,end]
 * range, so a legacy generation bug (dates outside the range / over-counts) can't
 * inflate the expected count.
 *
 * Each posted net-positive payment is greedily assigned to its nearest unfilled
 * occurrence by date. Status:
 *   - none: nothing net received (or nothing due)
 *   - partial: some occurrences paid (or all paid but, for fixed, underpaid)
 *   - complete: all occurrences paid (and, for fixed, amount met)
 *   - over: more payments than occurrences (or fixed amount exceeded)
 *
 * PURE FUNCTION.
 */
export function compute_period_reconciliation(
  period: PeriodForReconciliation,
  linked_splits: LinkedSplit[]
): ReconciliationResult {
  // Self-correct: only occurrences within the period's own date range.
  let due = period.occurrence_due_dates_ms
    .filter((d) => d >= period.start_ms && d <= period.end_ms)
    .sort((a, b) => a - b);

  let matched_amount = 0;
  let pending_amount = 0;
  for (const split of linked_splits) {
    if (split.is_pending) {
      pending_amount += split.amount;
    } else {
      matched_amount += split.amount;
    }
  }

  // Back-compat safety net: periods generated without occurrence data (no
  // occurrenceDueDates / firstDueDateInPeriod) would otherwise expect 0 occurrences
  // and a posted payment would never reconcile. If a payment landed here, treat the
  // period as a single occurrence (presence-based) so it still marks paid — matching
  // the old amount-based behavior until the period is regenerated with real data.
  if (due.length === 0) {
    const posted_dates = linked_splits
      .filter((s) => !s.is_pending && s.amount > AMOUNT_EPSILON)
      .map((s) => s.date_ms);
    if (posted_dates.length > 0) {
      due = [Math.min(...posted_dates)];
    }
  }
  const occurrences_expected = due.length;
  const expected_amount = occurrences_expected * period.amount_per_occurrence;

  // Net each posted payment into its NEAREST occurrence by date (multiple payments
  // — installments, refunds — can apply to one occurrence; refunds net it down).
  const occ_sum = new Array<number>(due.length).fill(0);
  const occ_txn = new Array<string | null>(due.length).fill(null);
  for (const s of linked_splits) {
    if (s.is_pending || due.length === 0) continue;
    let best = 0;
    let best_dist = Infinity;
    for (let i = 0; i < due.length; i++) {
      const dist = Math.abs(due[i] - s.date_ms);
      if (dist < best_dist) {
        best_dist = dist;
        best = i;
      }
    }
    occ_sum[best] += s.amount;
    if (s.amount > AMOUNT_EPSILON && occ_txn[best] === null) {
      occ_txn[best] = s.transaction_id;
    }
  }

  // An occurrence is paid when its net amount is positive (variable) or meets the
  // per-occurrence amount (fixed).
  const occurrences: OccurrenceStatus[] = due.map((d, i) => ({
    due_date_ms: d,
    paid: period.is_variable_amount
      ? occ_sum[i] > AMOUNT_EPSILON
      : occ_sum[i] >= period.amount_per_occurrence - AMOUNT_EPSILON,
    transaction_id: occ_txn[i],
    amount: occ_txn[i] === null ? null : occ_sum[i],
  }));
  const occurrences_paid = occurrences.filter((o) => o.paid).length;

  const status = compute_status({
    is_variable: period.is_variable_amount,
    occurrences_expected,
    occurrences_paid,
    matched_amount,
    expected_amount,
  });

  return {
    period_id: period.period_id,
    status,
    matched_amount,
    pending_amount,
    expected_amount,
    occurrences_expected,
    occurrences_paid,
    occurrences,
    matched_splits: linked_splits,
  };
}

/** Occurrence-driven status; fixed items also flag amount over/under. */
function compute_status(p: {
  is_variable: boolean;
  occurrences_expected: number;
  occurrences_paid: number;
  matched_amount: number;
  expected_amount: number;
}): ReconciliationStatus {
  if (p.occurrences_expected === 0) {
    return p.matched_amount > AMOUNT_EPSILON ? "over" : "none"; // nothing due
  }
  if (p.matched_amount <= AMOUNT_EPSILON) {
    return "none"; // nothing net received (e.g. fully refunded)
  }
  const all_occurrences_paid = p.occurrences_paid >= p.occurrences_expected;
  if (all_occurrences_paid) {
    // Fixed: overpaid beyond the expected total ⇒ over.
    if (!p.is_variable && p.matched_amount > p.expected_amount + AMOUNT_EPSILON) {
      return "over";
    }
    return "complete";
  }
  return "partial";
}
