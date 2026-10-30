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
exports.EARLY_CARRY_MAX_MS = exports.EPOCH_MS = void 0;
exports.is_suppressed_in_period = is_suppressed_in_period;
exports.is_currently_suppressed = is_currently_suppressed;
exports.current_removal_state = current_removal_state;
exports.apply_remove = apply_remove;
exports.apply_pause = apply_pause;
exports.apply_restore = apply_restore;
exports.apply_end_at = apply_end_at;
exports.is_removed_now = is_removed_now;
exports.pending_end = pending_end;
exports.is_payment_suppressed = is_payment_suppressed;
exports.carried_early_payment_ms = carried_early_payment_ms;
exports.is_stored_period_active = is_stored_period_active;
exports.resnap_period_decision = resnap_period_decision;
exports.stored_occurrence_due_ms = stored_occurrence_due_ms;
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
    // An END that hasn't started yet ("It ended" after this month's payment) is simply cancelled.
    // Only `apply_end_at` makes a future-starting interval, so today's data is unaffected.
    return close_active_at(intervals, now_ms).filter((i) => !(i.from_ms > now_ms && i.to_ms === null));
}
/** Start of the UTC month after the one containing `ms`. */
function next_month_start_utc(ms) {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}
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
function apply_end_at(intervals, last_payment_ms, now_ms, month_start_ms) {
    // Never SHORTEN a suppression already in effect (review round 3 defect 5): ending a bill that is
    // removed or paused right now must not bring it back for the rest of the month.
    //  - an indefinite removal covers now ("Remove" all / going forward): it already ends the bill —
    //    nothing changes (the caller only closes the question);
    //  - a pause covers now: it is closed and the end starts no later than the pause did, so the
    //    current month stays suppressed and the pause never resumes.
    const active = intervals.find((i) => interval_covers_now(i, now_ms));
    if (active && active.to_ms === null)
        return intervals;
    const superseded = close_active_at(intervals, now_ms);
    const natural = last_payment_ms === null
        ? month_start_ms
        : Math.min(next_month_start_utc(last_payment_ms), next_month_start_utc(now_ms));
    const from_ms = active ? Math.min(natural, active.from_ms) : natural;
    // Drop any not-yet-started end being replaced (re-answering moves it, never stacks it).
    const kept = superseded.filter((i) => !(i.from_ms > now_ms && i.to_ms === null));
    return [...kept, { from_ms, to_ms: null, mode: "going_forward" }];
}
/**
 * Is the item REMOVED / ended right now (a paused one is still a live bill: converting one of its
 * payments would make a second bill)? PURE.
 */
function is_removed_now(intervals, now_ms) {
    return (intervals !== null && intervals !== void 0 ? intervals : []).some((i) => i.mode !== "paused" && i.from_ms <= now_ms && (i.to_ms === null || now_ms < i.to_ms));
}
/** The open (indefinite) interval that starts after `now_ms`, if any — an end not yet in effect. */
function pending_end(intervals, now_ms) {
    var _a;
    return (_a = intervals.find((i) => i.from_ms > now_ms && i.to_ms === null)) !== null && _a !== void 0 ? _a : null;
}
/**
 * Does a payment dated `txn_date_ms` fall in a period where the item is removed / paused? Snaps
 * to the payment's (UTC) MONTH — the home period, as the stored periods are suppressed — so every
 * payment in a removed month is released together. A released payment pays nothing and counts as
 * ordinary spending / money in instead (the engine and the period page apply the same rule).
 */
function is_payment_suppressed(intervals, txn_date_ms) {
    if (!intervals || intervals.length === 0)
        return false;
    const d = new Date(txn_date_ms);
    const month_end_ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 1;
    return is_suppressed_in_period(intervals, month_end_ms);
}
/**
 * D28 — an occurrence due in a removed / paused / ended (UTC) month that was paid EARLY, by a
 * payment made in a month that ISN'T suppressed (due Oct 1, paid Sep 29, removed from Oct 1),
 * counts as paid in the month the payment was made. The engine links that payment to the bill
 * (it routes by the payment's own month), so dropping the occurrence by its due month left the
 * payment counted nowhere — not paid, not budget spend — in every view.
 * Early = at most EARLY_CARRY_MAX_MS before the due date (the derive's match tolerance). Returns
 * the date the occurrence counts at (the payment's), or null when the rule doesn't apply. PURE.
 */
exports.EARLY_CARRY_MAX_MS = 7 * 24 * 60 * 60 * 1000;
function carried_early_payment_ms(intervals, due_ms, payment_ms) {
    if (!intervals || intervals.length === 0 || payment_ms === null || payment_ms === undefined)
        return null;
    if (payment_ms >= due_ms || due_ms - payment_ms > exports.EARLY_CARRY_MAX_MS)
        return null;
    if (!is_payment_suppressed(intervals, due_ms) || is_payment_suppressed(intervals, payment_ms))
        return null;
    return payment_ms;
}
/**
 * Is a STORED (materialized) period active under the removal intervals? (D27 — the same month
 * rule as the derive, b6a8281.) A period is active when it isn't suppressed as a whole (judged by
 * its END, the whole-period snap), OR when ANY of its occurrences falls in a (UTC) month that isn't
 * suppressed — the derive shows such a bucket with the occurrences it keeps. Monthly periods are
 * unchanged (an occurrence's month IS the period); a week straddling a removal start, or the part
 * of a month restored after a restore day, now matches the period page and the engine.
 * Periods with no intervals are always active.
 */
function is_stored_period_active(intervals, period_end_ms, occurrence_due_ms) {
    if (!intervals || intervals.length === 0)
        return true;
    if (!is_suppressed_in_period(intervals, period_end_ms))
        return true;
    return occurrence_due_ms.some((ms) => !is_payment_suppressed(intervals, ms));
}
/**
 * The ONE-OFF re-snap's decision for one stored period (round 4 defect 4). The re-snap corrects
 * only periods still in the state the OLD whole-period rule (judged by the period's end) gave them
 * AND where the month rule now says otherwise — a period inactive or active for any OTHER reason
 * (stored ≠ the old rule) is never touched. `in_window_active`: stored active although both rules
 * say inactive (e.g. an old income's periods the old creators made active inside its removal
 * window) — not flipped, reported separately by the dry run. PURE.
 */
function resnap_period_decision(intervals, period_end_ms, occurrence_due_ms, stored_active) {
    const old_active = !intervals || intervals.length === 0 || !is_suppressed_in_period(intervals, period_end_ms);
    const next_active = is_stored_period_active(intervals, period_end_ms, occurrence_due_ms);
    return {
        flip: stored_active === old_active && old_active !== next_active,
        next_active,
        in_window_active: stored_active && !old_active && !next_active,
    };
}
/** The occurrence due dates a stored period doc carries (ms) — the legacy parallel array
 *  `occurrenceDueDates` or the `occurrences` objects' `dueDate`, whichever it has. PURE. */
function stored_occurrence_due_ms(doc) {
    const ms = (t) => {
        const v = t;
        return v && typeof v.toMillis === "function" ? v.toMillis() : null;
    };
    const from_array = Array.isArray(doc.occurrenceDueDates) ? doc.occurrenceDueDates.map(ms) : [];
    const from_objects = Array.isArray(doc.occurrences)
        ? doc.occurrences.map((o) => ms(o === null || o === void 0 ? void 0 : o.dueDate))
        : [];
    return [...new Set([...from_array, ...from_objects].filter((x) => x !== null))];
}
//# sourceMappingURL=recurring_suppression.service.js.map