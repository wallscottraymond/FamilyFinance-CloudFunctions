"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.EPOCH_MS = void 0;
exports.is_suppressed_in_period = is_suppressed_in_period;
exports.is_currently_suppressed = is_currently_suppressed;
exports.current_removal_state = current_removal_state;
exports.apply_remove = apply_remove;
exports.apply_pause = apply_pause;
exports.apply_restore = apply_restore;
/** `all` removals begin at the epoch (covers all history). */
exports.EPOCH_MS = 0;
/** Is a single interval suppressing `now_ms`? */
function interval_covers_now(interval, now_ms) {
    return now_ms >= interval.from_ms && (interval.to_ms === null || now_ms < interval.to_ms);
}
/**
 * Is the item suppressed for a whole period bucket? Compares the period's END to
 * the interval bounds so the period straddling a boundary is included/excluded in
 * full — cadence-agnostic (uses whatever `period_end_ms` the viewing cadence gives).
 */
function is_suppressed_in_period(intervals, period_end_ms) {
    return intervals.some((i) => period_end_ms > i.from_ms && (i.to_ms === null || period_end_ms <= i.to_ms));
}
/** Is the item suppressed right now? (Any interval currently covering `now_ms`.) */
function is_currently_suppressed(intervals, now_ms) {
    return intervals.some((i) => interval_covers_now(i, now_ms));
}
/** The item's current state — the interval covering `now_ms` (if any) decides it. */
function current_removal_state(intervals, now_ms) {
    const active = intervals.find((i) => interval_covers_now(i, now_ms));
    if (!active)
        return { status: "active", resume_ms: null };
    if (active.mode === "paused")
        return { status: "paused", resume_ms: active.to_ms };
    return { status: "removed", resume_ms: null };
}
/**
 * Close whichever interval currently covers `now_ms` at `now_ms` (forward-only) —
 * turning its elapsed portion into a permanent gap. Used by restore/resume and to
 * supersede the active interval before opening a new one. No-op if nothing is active.
 */
function close_active_at(intervals, now_ms) {
    return intervals.map((i) => interval_covers_now(i, now_ms) ? Object.assign(Object.assign({}, i), { to_ms: now_ms }) : i);
}
/**
 * Apply a REMOVE. Supersedes any currently-active interval (closes it at `now_ms`,
 * leaving that span as a permanent gap), then opens the new removal.
 *  - `all`           → from the epoch.
 *  - `going_forward` → from the current month's start.
 */
function apply_remove(intervals, mode, now_ms, month_start_ms) {
    const superseded = close_active_at(intervals, now_ms);
    const from_ms = mode === "all" ? exports.EPOCH_MS : month_start_ms;
    return [...superseded, { from_ms, to_ms: null, mode }];
}
/**
 * Apply a PAUSE until `resume_ms`. Supersedes any currently-active interval, then
 * opens a bounded `paused` interval from the current month's start to the resume date.
 * (Caller validates `resume_ms` is in the future.)
 */
function apply_pause(intervals, resume_ms, now_ms, month_start_ms) {
    const superseded = close_active_at(intervals, now_ms);
    return [...superseded, { from_ms: month_start_ms, to_ms: resume_ms, mode: "paused" }];
}
/**
 * Apply a RESTORE / RESUME. Forward-only: closes the currently-active interval at
 * `now_ms`; the already-suppressed span stays a permanent gap. No-op if nothing is
 * active (idempotent).
 */
function apply_restore(intervals, now_ms) {
    return close_active_at(intervals, now_ms);
}
//# sourceMappingURL=recurring_suppression.service.js.map