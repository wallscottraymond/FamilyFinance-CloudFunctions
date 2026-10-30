/**
 * Recurring Suppression Domain Service
 *
 * Remove & Recover Recurring (Bills + Income) — the pure core.
 *
 * A recurring item (outflow/inflow) carries a list of `RemovalInterval`s that
 * describe when a user has REMOVED or PAUSED it. Suppression is derived ON READ
 * from these intervals (never a stale stored boolean), so history is preserved,
 * forward-only restore leaves a permanent gap, and pause auto-resumes with no job.
 *
 * Two checks:
 *  - `is_suppressed_in_period` — for period views + all derived surfaces
 *    (projections/totals/budgets). Snaps to WHOLE periods by comparing the
 *    period's END to the interval bounds, so the period CONTAINING a boundary is
 *    included/excluded in full — identical in monthly/weekly/bi-weekly.
 *  - `is_currently_suppressed` — the "right now" state, for lists, the ⋮ menu, and
 *    Plaid-sync protection.
 *
 * Modes:
 *  - `all`           → removed across all time (`from_ms = 0`, `to_ms = null`).
 *  - `going_forward` → removed from the current month on (`from_ms = monthStart`, `to_ms = null`).
 *  - `paused`        → hidden from the current month until a chosen resume date
 *                      (`from_ms = monthStart`, `to_ms = resume`), then auto-resumes.
 *
 * PURE: no IO. Time is passed in as ms (`now_ms`, `month_start_ms`, `resume_ms`).
 *
 * @module domain/recurring/recurring_suppression
 */
export type RemovalMode = "all" | "going_forward" | "paused";
/** A span during which the item is suppressed. `to_ms === null` = still open (an
 * indefinite removal); a `paused` interval always has a concrete `to_ms`. */
export interface RemovalInterval {
    from_ms: number;
    to_ms: number | null;
    mode: RemovalMode;
}
/** The item's current, user-facing suppression state (drives the ⋮ menu + labels). */
export interface RemovalState {
    status: "active" | "paused" | "removed";
    /** For `paused`: when it will auto-resume. */
    resume_ms: number | null;
}
/** `all` removals begin at the epoch (covers all history). */
export declare const EPOCH_MS = 0;
/**
 * Is the item suppressed for a whole period bucket? Compares the period's END to
 * the interval bounds so the period straddling a boundary is included/excluded in
 * full — cadence-agnostic (uses whatever `period_end_ms` the viewing cadence gives).
 */
export declare function is_suppressed_in_period(intervals: RemovalInterval[], period_end_ms: number): boolean;
/** Is the item suppressed right now? (Any interval currently covering `now_ms`.) */
export declare function is_currently_suppressed(intervals: RemovalInterval[], now_ms: number): boolean;
/** The item's current state — the interval covering `now_ms` (if any) decides it. */
export declare function current_removal_state(intervals: RemovalInterval[], now_ms: number): RemovalState;
/**
 * Apply a REMOVE. Supersedes any currently-active interval (closes it at `now_ms`,
 * leaving that span as a permanent gap), then opens the new removal.
 *  - `all`           → from the epoch.
 *  - `going_forward` → from the current month's start.
 */
export declare function apply_remove(intervals: RemovalInterval[], mode: "all" | "going_forward", now_ms: number, month_start_ms: number): RemovalInterval[];
/**
 * Apply a PAUSE until `resume_ms`. Supersedes any currently-active interval, then
 * opens a bounded `paused` interval from the current month's start to the resume date.
 * (Caller validates `resume_ms` is in the future.)
 */
export declare function apply_pause(intervals: RemovalInterval[], resume_ms: number, now_ms: number, month_start_ms: number): RemovalInterval[];
/**
 * Apply a RESTORE / RESUME. Forward-only: closes the currently-active interval at
 * `now_ms`; the already-suppressed span stays a permanent gap. No-op if nothing is
 * active (idempotent).
 */
export declare function apply_restore(intervals: RemovalInterval[], now_ms: number): RemovalInterval[];
/**
 * Apply an END ("It ended", Convert-To-Recurring X4 / D22 / D23): a going-forward removal that
 * starts the month AFTER the last payment — so every month up to and including the last payment
 * keeps its bill (history, paid marks, pins intact), and nothing is expected after it. With no
 * known payment it starts this month (like a going-forward remove). Never later than next month
 * (an end can't be pushed past the current month's payment). Supersedes the active interval, as
 * remove does. Restore undoes it (a not-yet-started end is cancelled outright).
 *
 * The same mechanism every reader already honors (derive, engine, reconcile, stored periods) —
 * the bill is NOT turned inactive, so past periods and its detail keep working.
 */
export declare function apply_end_at(intervals: RemovalInterval[], last_payment_ms: number | null, now_ms: number, month_start_ms: number): RemovalInterval[];
/**
 * Is the item REMOVED / ended right now (a paused one is still a live bill: converting one of its
 * payments would make a second bill)? PURE.
 */
export declare function is_removed_now(intervals: RemovalInterval[] | undefined, now_ms: number): boolean;
/** The open (indefinite) interval that starts after `now_ms`, if any — an end not yet in effect. */
export declare function pending_end(intervals: RemovalInterval[], now_ms: number): RemovalInterval | null;
/**
 * Does a payment dated `txn_date_ms` fall in a period where the item is removed / paused? Snaps
 * to the payment's (UTC) MONTH — the home period, as the stored periods are suppressed — so every
 * payment in a removed month is released together. A released payment pays nothing and counts as
 * ordinary spending / money in instead (the engine and the period page apply the same rule).
 */
export declare function is_payment_suppressed(intervals: RemovalInterval[] | undefined, txn_date_ms: number): boolean;
/**
 * D28 — an occurrence due in a removed / paused / ended (UTC) month that was paid EARLY, by a
 * payment made in a month that ISN'T suppressed (due Oct 1, paid Sep 29, removed from Oct 1),
 * counts as paid in the month the payment was made. The engine links that payment to the bill
 * (it routes by the payment's own month), so dropping the occurrence by its due month left the
 * payment counted nowhere — not paid, not budget spend — in every view.
 * Early = at most EARLY_CARRY_MAX_MS before the due date (the derive's match tolerance). Returns
 * the date the occurrence counts at (the payment's), or null when the rule doesn't apply. PURE.
 */
export declare const EARLY_CARRY_MAX_MS: number;
export declare function carried_early_payment_ms(intervals: RemovalInterval[] | undefined, due_ms: number, payment_ms: number | null | undefined): number | null;
/**
 * Is a STORED (materialized) period active under the removal intervals? (D27 — the same month
 * rule as the derive, b6a8281.) A period is active when it isn't suppressed as a whole (judged by
 * its END, the whole-period snap), OR when ANY of its occurrences falls in a (UTC) month that isn't
 * suppressed — the derive shows such a bucket with the occurrences it keeps. Monthly periods are
 * unchanged (an occurrence's month IS the period); a week straddling a removal start, or the part
 * of a month restored after a restore day, now matches the period page and the engine.
 * Periods with no intervals are always active.
 */
export declare function is_stored_period_active(intervals: RemovalInterval[] | undefined, period_end_ms: number, occurrence_due_ms: number[]): boolean;
/**
 * The ONE-OFF re-snap's decision for one stored period (round 4 defect 4). The re-snap corrects
 * only periods still in the state the OLD whole-period rule (judged by the period's end) gave them
 * AND where the month rule now says otherwise — a period inactive or active for any OTHER reason
 * (stored ≠ the old rule) is never touched. `in_window_active`: stored active although both rules
 * say inactive (e.g. an old income's periods the old creators made active inside its removal
 * window) — not flipped, reported separately by the dry run. PURE.
 */
export declare function resnap_period_decision(intervals: RemovalInterval[] | undefined, period_end_ms: number, occurrence_due_ms: number[], stored_active: boolean): {
    flip: boolean;
    next_active: boolean;
    in_window_active: boolean;
};
/** The occurrence due dates a stored period doc carries (ms) — the legacy parallel array
 *  `occurrenceDueDates` or the `occurrences` objects' `dueDate`, whichever it has. PURE. */
export declare function stored_occurrence_due_ms(doc: {
    occurrenceDueDates?: unknown;
    occurrences?: unknown;
}): number[];
//# sourceMappingURL=recurring_suppression.service.d.ts.map