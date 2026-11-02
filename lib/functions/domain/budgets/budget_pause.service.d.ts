/**
 * Budget Pause Domain Service (pure)
 *
 * Code-Health-Review M1-M1, decisions PZ1–PZ6. A budget pause covers EXACTLY the days of the
 * period the user paused, stored on the budget as inclusive UTC-day ranges. Read time does the
 * rest — no split is ever rewritten:
 *   - a split dated on a paused day belongs to Everything Else (resolve_split_owner)
 *   - the budget's allocation leaves the paused days out (derive_budget_view_periods)
 *   - stored `spent` leaves them out, and rollover carries the unpaused share (PZ6)
 *
 * Days are UTC day indexes (days since the epoch) — the project-wide UTC day rule.
 *
 * @module domain/budgets/budget_pause
 */
/** An inclusive range of paused UTC days (day indexes since the epoch). */
export interface PausedDayRange {
    start_day: number;
    end_day: number;
}
/** UTC day index of an instant. PURE. */
export declare function utc_day(ms: number): number;
/** "YYYY-MM-DD" → UTC day index; null when malformed or impossible (Feb 30). PURE. */
export declare function day_from_iso(iso: string): number | null;
/** UTC day index → "YYYY-MM-DD". PURE. */
export declare function iso_from_day(day: number): string;
/** Sorted, overlapping/adjacent ranges merged, invalid ones dropped. PURE. */
export declare function normalize_paused_ranges(ranges: PausedDayRange[]): PausedDayRange[];
/**
 * Pause (union) or resume (subtract) the days [start_day, end_day] (inclusive). Resuming part of
 * a paused range keeps the rest paused (a resumed week inside a paused month splits it). PURE.
 */
export declare function apply_pause_change(ranges: PausedDayRange[], start_day: number, end_day: number, paused: boolean): PausedDayRange[];
/** True when the instant's UTC day is paused. PURE. */
export declare function is_paused_on(ranges: PausedDayRange[] | undefined, ms: number): boolean;
/** How many UTC days of [start_ms, end_ms] (inclusive) are paused. PURE. */
export declare function paused_days_in(ranges: PausedDayRange[] | undefined, start_ms: number, end_ms: number): number;
/**
 * The NOT-paused parts of [start_ms, end_ms] as inclusive ms ranges (each from a day's first
 * millisecond to its last; the outer ends keep the caller's own instants). No pause → the whole
 * range, unchanged. PURE.
 */
export declare function unpaused_segments(ranges: PausedDayRange[] | undefined, start_ms: number, end_ms: number): Array<{
    start_ms: number;
    end_ms: number;
}>;
/**
 * The items NOT dated on a paused day (the budget's stored `spent` and rollover leave paused days
 * out — PZ6). No pause → the same array. PURE.
 */
export declare function without_paused_days<T extends {
    txn_date_ms: number;
}>(items: T[], ranges: PausedDayRange[] | undefined): T[];
/**
 * Auto-resume on re-categorize (Code-Health-Review S1-M4 follow-up; user decision 2026-11-02):
 * a budget that came back to Me with NO categories was paused from that day on. When an edit
 * gives a category-less budget categories again, its paused days from TODAY's UTC day onward are
 * cleared (past paused days stay paused). Only that empty → non-empty transition: a pause on a
 * budget that has categories is the user's own and is never touched here.
 *
 * @returns the new ranges, or null when nothing changes. PURE.
 */
export declare function resume_on_recategorize(input: {
    before_category_ids: string[];
    after_category_ids: string[];
    paused_ranges: PausedDayRange[] | undefined;
    now_ms: number;
}): PausedDayRange[] | null;
/** The longest stretch one pause call may cover (a period is at most a month). */
export declare const MAX_PAUSE_DAYS = 62;
/** Bound on stored ranges (backend rule 9: every array field has a bound). */
export declare const MAX_PAUSED_RANGES = 120;
/**
 * Validate and apply one pause / resume of [start, end] ("YYYY-MM-DD", inclusive) to the
 * budget's current ranges. Everything Else can't be paused (it is where paused spending goes).
 * PURE.
 */
export declare function compute_budget_pause(input: {
    current: PausedDayRange[];
    start_day: string;
    end_day: string;
    paused: boolean;
    is_everything_else: boolean;
}): {
    entity?: PausedDayRange[];
    validation_errors?: string[];
};
/**
 * The instants whose stored budget periods must recompute `spent` after a pause change: noon of
 * every day in [start, end] (a stored period of any cadence containing one of them). PURE.
 */
export declare function pause_recompute_dates(start_day: string, end_day: string): number[];
//# sourceMappingURL=budget_pause.service.d.ts.map