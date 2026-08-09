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
//# sourceMappingURL=recurring_suppression.service.d.ts.map