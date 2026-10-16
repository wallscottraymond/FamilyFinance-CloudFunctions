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
export const EPOCH_MS = 0;

/** Is a single interval suppressing `now_ms`? */
function interval_covers_now(interval: RemovalInterval, now_ms: number): boolean {
  return now_ms >= interval.from_ms && (interval.to_ms === null || now_ms < interval.to_ms);
}

/**
 * Is the item suppressed for a whole period bucket? Compares the period's END to
 * the interval bounds so the period straddling a boundary is included/excluded in
 * full — cadence-agnostic (uses whatever `period_end_ms` the viewing cadence gives).
 */
export function is_suppressed_in_period(
  intervals: RemovalInterval[],
  period_end_ms: number
): boolean {
  return intervals.some(
    (i) => period_end_ms > i.from_ms && (i.to_ms === null || period_end_ms <= i.to_ms)
  );
}

/** Is the item suppressed right now? (Any interval currently covering `now_ms`.) */
export function is_currently_suppressed(intervals: RemovalInterval[], now_ms: number): boolean {
  return intervals.some((i) => interval_covers_now(i, now_ms));
}

/** The item's current state — the interval covering `now_ms` (if any) decides it. */
export function current_removal_state(intervals: RemovalInterval[], now_ms: number): RemovalState {
  const active = intervals.find((i) => interval_covers_now(i, now_ms));
  if (!active) return { status: "active", resume_ms: null };
  if (active.mode === "paused") return { status: "paused", resume_ms: active.to_ms };
  return { status: "removed", resume_ms: null };
}

/**
 * Close whichever interval currently covers `now_ms` at `now_ms` (forward-only) —
 * turning its elapsed portion into a permanent gap. Used by restore/resume and to
 * supersede the active interval before opening a new one. No-op if nothing is active.
 */
function close_active_at(intervals: RemovalInterval[], now_ms: number): RemovalInterval[] {
  return intervals.map((i) =>
    interval_covers_now(i, now_ms) ? { ...i, to_ms: now_ms } : i
  );
}

/**
 * Apply a REMOVE. Supersedes any currently-active interval (closes it at `now_ms`,
 * leaving that span as a permanent gap), then opens the new removal.
 *  - `all`           → from the epoch.
 *  - `going_forward` → from the current month's start.
 */
export function apply_remove(
  intervals: RemovalInterval[],
  mode: "all" | "going_forward",
  now_ms: number,
  month_start_ms: number
): RemovalInterval[] {
  const superseded = close_active_at(intervals, now_ms);
  const from_ms = mode === "all" ? EPOCH_MS : month_start_ms;
  return [...superseded, { from_ms, to_ms: null, mode }];
}

/**
 * Apply a PAUSE until `resume_ms`. Supersedes any currently-active interval, then
 * opens a bounded `paused` interval from the current month's start to the resume date.
 * (Caller validates `resume_ms` is in the future.)
 */
export function apply_pause(
  intervals: RemovalInterval[],
  resume_ms: number,
  now_ms: number,
  month_start_ms: number
): RemovalInterval[] {
  const superseded = close_active_at(intervals, now_ms);
  return [...superseded, { from_ms: month_start_ms, to_ms: resume_ms, mode: "paused" }];
}

/**
 * Apply a RESTORE / RESUME. Forward-only: closes the currently-active interval at
 * `now_ms`; the already-suppressed span stays a permanent gap. No-op if nothing is
 * active (idempotent).
 */
export function apply_restore(intervals: RemovalInterval[], now_ms: number): RemovalInterval[] {
  // An END that hasn't started yet ("It ended" after this month's payment) is simply cancelled.
  // Only `apply_end_at` makes a future-starting interval, so today's data is unaffected.
  return close_active_at(intervals, now_ms).filter((i) => !(i.from_ms > now_ms && i.to_ms === null));
}

/** Start of the UTC month after the one containing `ms`. */
function next_month_start_utc(ms: number): number {
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
export function apply_end_at(
  intervals: RemovalInterval[],
  last_payment_ms: number | null,
  now_ms: number,
  month_start_ms: number
): RemovalInterval[] {
  // Never SHORTEN a suppression already in effect (review round 3 defect 5): ending a bill that is
  // removed or paused right now must not bring it back for the rest of the month.
  //  - an indefinite removal covers now ("Remove" all / going forward): it already ends the bill —
  //    nothing changes (the caller only closes the question);
  //  - a pause covers now: it is closed and the end starts no later than the pause did, so the
  //    current month stays suppressed and the pause never resumes.
  const active = intervals.find((i) => interval_covers_now(i, now_ms));
  if (active && active.to_ms === null) return intervals;
  const superseded = close_active_at(intervals, now_ms);
  const natural =
    last_payment_ms === null
      ? month_start_ms
      : Math.min(next_month_start_utc(last_payment_ms), next_month_start_utc(now_ms));
  const from_ms = active ? Math.min(natural, active.from_ms) : natural;
  // Drop any not-yet-started end being replaced (re-answering moves it, never stacks it).
  const kept = superseded.filter((i) => !(i.from_ms > now_ms && i.to_ms === null));
  return [...kept, { from_ms, to_ms: null, mode: "going_forward" }];
}

/** The open (indefinite) interval that starts after `now_ms`, if any — an end not yet in effect. */
export function pending_end(intervals: RemovalInterval[], now_ms: number): RemovalInterval | null {
  return intervals.find((i) => i.from_ms > now_ms && i.to_ms === null) ?? null;
}

/**
 * Does a payment dated `txn_date_ms` fall in a period where the item is removed / paused? Snaps
 * to the payment's (UTC) MONTH — the home period, as the stored periods are suppressed — so every
 * payment in a removed month is released together. A released payment pays nothing and counts as
 * ordinary spending / money in instead (the engine and the period page apply the same rule).
 */
export function is_payment_suppressed(
  intervals: RemovalInterval[] | undefined,
  txn_date_ms: number
): boolean {
  if (!intervals || intervals.length === 0) return false;
  const d = new Date(txn_date_ms);
  const month_end_ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 1;
  return is_suppressed_in_period(intervals, month_end_ms);
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
export function is_stored_period_active(
  intervals: RemovalInterval[] | undefined,
  period_end_ms: number,
  occurrence_due_ms: number[]
): boolean {
  if (!intervals || intervals.length === 0) return true;
  if (!is_suppressed_in_period(intervals, period_end_ms)) return true;
  return occurrence_due_ms.some((ms) => !is_payment_suppressed(intervals, ms));
}

/** The occurrence due dates a stored period doc carries (ms) — the legacy parallel array
 *  `occurrenceDueDates` or the `occurrences` objects' `dueDate`, whichever it has. PURE. */
export function stored_occurrence_due_ms(doc: {
  occurrenceDueDates?: unknown;
  occurrences?: unknown;
}): number[] {
  const ms = (t: unknown): number | null => {
    const v = t as { toMillis?: () => number } | null;
    return v && typeof v.toMillis === "function" ? v.toMillis() : null;
  };
  const from_array = Array.isArray(doc.occurrenceDueDates) ? doc.occurrenceDueDates.map(ms) : [];
  const from_objects = Array.isArray(doc.occurrences)
    ? (doc.occurrences as Array<{ dueDate?: unknown }>).map((o) => ms(o?.dueDate))
    : [];
  return [...new Set([...from_array, ...from_objects].filter((x): x is number => x !== null))];
}
