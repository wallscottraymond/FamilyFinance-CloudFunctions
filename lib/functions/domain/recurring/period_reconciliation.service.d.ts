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
import { ManualSettledOccurrences } from "./manual_settlement.service";
import { RemovalInterval } from "./recurring_suppression.service";
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
/** A stored period of ONE type, active or not (D28 carry). */
export interface CarryPeriod {
    period_id: string;
    start_ms: number;
    end_ms: number;
    occurrence_due_dates_ms: number[];
}
/** Where a payment that carries a removed month's occurrence lands. */
export interface CarriedPayment {
    /** Index of the payment in the input list. */
    index: number;
    /** The period (of this type, active or not) whose range holds the payment date. */
    period_id: string;
    /** The suppressed-month occurrence it paid early — or (`late`) the kept one it paid late. */
    carried_due_ms: number;
    /** D31: a payment made in a suppressed month that pays the occurrence before the cut-off LATE
     *  (due Sep 29, paid Oct 2, removed from Oct 1) — placed in the period holding that occurrence
     *  (which keeps its due date). Absent = early (D28). */
    late?: true;
}
/**
 * D28 (stored periods, the derive's rule): a payment made in a month that isn't suppressed, a few
 * days BEFORE an occurrence due in a removed / paused / ended month (due Oct 1, paid Sep 29,
 * removed from Oct 1), pays that occurrence — counted as paid where the payment was made: the
 * period of this type containing its date, which then expects that occurrence AT the payment date.
 *
 * Round 5 defects 3 + 4: WHICH payment pays which occurrence is decided by the derive's own
 * matcher (`reconcile_occurrences`, run over this type's due dates and the payments) — exactly
 * what it assigns to a suppressed occurrence is carried. Two early payments for one occurrence
 * carry only the one the matcher gives it (the other stays an ordinary payment, as on the page);
 * a tie, or an occurrence already paid, breaks the way the derive breaks it. PURE.
 */
export declare function carried_payments(periods: CarryPeriod[], payments: Array<{
    date_ms: number;
    amount: number;
}>, intervals: RemovalInterval[]): CarriedPayment[];
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
    /** True when this occurrence is satisfied ONLY by a still-pending payment. */
    pending: boolean;
    /** Settled by the user's "Mark as paid / received" (no transaction; `amount` = the mark). */
    manual: boolean;
}
export interface ReconciliationResult {
    period_id: string;
    status: ReconciliationStatus;
    /** Posted net amount (refunds subtracted). */
    matched_amount: number;
    /** Pending-only amount (tracked separately; does NOT flip status). */
    pending_amount: number;
    /** Amount settled by "Mark as paid / received" marks (occurrences no real payment settled). */
    manual_amount: number;
    /** Recomputed = occurrences_expected × amount_per_occurrence (self-corrected). */
    expected_amount: number;
    /** Occurrences the period expects (self-corrected to its date range). */
    occurrences_expected: number;
    /** Occurrences with a payment assigned (posted OR pending — "count pending"). */
    occurrences_paid: number;
    /** True when ANY counted occurrence is satisfied only by a pending payment
     *  (drives the tile's "paid · pending" marker). */
    has_pending: boolean;
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
export declare function compute_period_reconciliation(period: PeriodForReconciliation, linked_splits: LinkedSplit[], manual_marks?: ManualSettledOccurrences): ReconciliationResult;
/** A stored transaction split — subset needed for the countable-amount math. */
export interface CountableSplitInput {
    amount?: number | null;
    isIgnored?: boolean;
    isRefund?: boolean;
    spendStatus?: string;
    splitId?: string;
}
/**
 * Net countable amount a transaction's splits contribute toward a recurring
 * occurrence: ignored splits are excluded, refunds SUBTRACT their magnitude, and
 * everything else ADDS its magnitude. Also resolves the split id (last split's
 * `splitId`, falling back to the provided default).
 *
 * Pure — moved here from `period_reconciliation.resolver.ts` so the resolver stays
 * lookup-only (per the layered architecture).
 */
export declare function compute_countable_split_net(splits: CountableSplitInput[], fallback_split_id: string): {
    amount: number;
    split_id: string;
};
//# sourceMappingURL=period_reconciliation.service.d.ts.map