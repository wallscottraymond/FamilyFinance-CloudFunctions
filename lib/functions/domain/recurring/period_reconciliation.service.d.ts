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
export type AlignmentReason = "in_range" | "early_autopay_next" | "nearest_due_date" | "no_match";
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
export declare function align_transaction_to_period(txn_date_ms: number, periods: PeriodForAlignment[], opts: AlignmentOptions): AlignmentResult;
/** Convenience: half the period length, the decided gap tolerance. */
export declare function default_tolerance_ms(period_start_ms: number, period_end_ms: number): number;
/** Cap on the early-autopay override window. */
export declare const MAX_EARLY_WINDOW_MS: number;
/**
 * Decided early-autopay override window, SCALED to the period so it stays small
 * relative to short (weekly) periods — otherwise a normal mid-week payment would
 * be mis-filed as an early payment for the next week. = min(5 days, ¼ period).
 */
export declare function default_early_window_ms(period_start_ms: number, period_end_ms: number): number;
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
export declare function compute_period_reconciliation(period: PeriodForReconciliation, linked_splits: LinkedSplit[]): ReconciliationResult;
//# sourceMappingURL=period_reconciliation.service.d.ts.map