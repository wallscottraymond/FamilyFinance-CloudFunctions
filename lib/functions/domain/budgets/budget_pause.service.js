"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_PAUSED_RANGES = exports.MAX_PAUSE_DAYS = void 0;
exports.utc_day = utc_day;
exports.day_from_iso = day_from_iso;
exports.iso_from_day = iso_from_day;
exports.normalize_paused_ranges = normalize_paused_ranges;
exports.apply_pause_change = apply_pause_change;
exports.is_paused_on = is_paused_on;
exports.paused_days_in = paused_days_in;
exports.unpaused_segments = unpaused_segments;
exports.without_paused_days = without_paused_days;
exports.resume_on_recategorize = resume_on_recategorize;
exports.compute_budget_pause = compute_budget_pause;
exports.pause_recompute_dates = pause_recompute_dates;
const DAY_MS = 86400000;
/** UTC day index of an instant. PURE. */
function utc_day(ms) {
    return Math.floor(ms / DAY_MS);
}
/** "YYYY-MM-DD" → UTC day index; null when malformed or impossible (Feb 30). PURE. */
function day_from_iso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m)
        return null;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const ms = Date.UTC(y, mo - 1, d);
    const back = new Date(ms);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
        return null;
    }
    return utc_day(ms);
}
/** UTC day index → "YYYY-MM-DD". PURE. */
function iso_from_day(day) {
    return new Date(day * DAY_MS).toISOString().slice(0, 10);
}
/** Sorted, overlapping/adjacent ranges merged, invalid ones dropped. PURE. */
function normalize_paused_ranges(ranges) {
    const valid = ranges
        .filter((r) => Number.isInteger(r.start_day) && Number.isInteger(r.end_day) && r.end_day >= r.start_day)
        .map((r) => ({ start_day: r.start_day, end_day: r.end_day }))
        .sort((a, b) => a.start_day - b.start_day);
    const out = [];
    for (const r of valid) {
        const last = out[out.length - 1];
        if (last && r.start_day <= last.end_day + 1) {
            last.end_day = Math.max(last.end_day, r.end_day);
        }
        else {
            out.push(r);
        }
    }
    return out;
}
/**
 * Pause (union) or resume (subtract) the days [start_day, end_day] (inclusive). Resuming part of
 * a paused range keeps the rest paused (a resumed week inside a paused month splits it). PURE.
 */
function apply_pause_change(ranges, start_day, end_day, paused) {
    if (end_day < start_day)
        return normalize_paused_ranges(ranges);
    if (paused) {
        return normalize_paused_ranges([...ranges, { start_day, end_day }]);
    }
    const out = [];
    for (const r of normalize_paused_ranges(ranges)) {
        if (r.end_day < start_day || r.start_day > end_day) {
            out.push(r);
            continue;
        }
        if (r.start_day < start_day)
            out.push({ start_day: r.start_day, end_day: start_day - 1 });
        if (r.end_day > end_day)
            out.push({ start_day: end_day + 1, end_day: r.end_day });
    }
    return out;
}
/** True when the instant's UTC day is paused. PURE. */
function is_paused_on(ranges, ms) {
    if (!ranges || ranges.length === 0)
        return false;
    const day = utc_day(ms);
    return ranges.some((r) => day >= r.start_day && day <= r.end_day);
}
/** How many UTC days of [start_ms, end_ms] (inclusive) are paused. PURE. */
function paused_days_in(ranges, start_ms, end_ms) {
    if (!ranges || ranges.length === 0)
        return 0;
    const a = utc_day(start_ms);
    const b = utc_day(end_ms);
    let days = 0;
    for (const r of normalize_paused_ranges(ranges)) {
        const lo = Math.max(a, r.start_day);
        const hi = Math.min(b, r.end_day);
        if (hi >= lo)
            days += hi - lo + 1;
    }
    return days;
}
/**
 * The NOT-paused parts of [start_ms, end_ms] as inclusive ms ranges (each from a day's first
 * millisecond to its last; the outer ends keep the caller's own instants). No pause → the whole
 * range, unchanged. PURE.
 */
function unpaused_segments(ranges, start_ms, end_ms) {
    if (!ranges || ranges.length === 0)
        return [{ start_ms, end_ms }];
    const a = utc_day(start_ms);
    const b = utc_day(end_ms);
    const days = [];
    let cursor = a;
    for (const r of normalize_paused_ranges(ranges)) {
        if (r.end_day < cursor)
            continue;
        if (r.start_day > b)
            break;
        if (r.start_day > cursor)
            days.push({ start_day: cursor, end_day: r.start_day - 1 });
        cursor = Math.max(cursor, r.end_day + 1);
        if (cursor > b)
            break;
    }
    if (cursor <= b)
        days.push({ start_day: cursor, end_day: b });
    return days.map((s) => ({
        start_ms: s.start_day === a ? start_ms : s.start_day * DAY_MS,
        end_ms: s.end_day === b ? end_ms : (s.end_day + 1) * DAY_MS - 1,
    }));
}
/**
 * The items NOT dated on a paused day (the budget's stored `spent` and rollover leave paused days
 * out — PZ6). No pause → the same array. PURE.
 */
function without_paused_days(items, ranges) {
    if (!ranges || ranges.length === 0)
        return items;
    return items.filter((i) => !is_paused_on(ranges, i.txn_date_ms));
}
/**
 * Auto-resume on re-categorize (Code-Health-Review S1-M4 follow-up; user decision 2026-11-02):
 * a budget that came back to Me with NO categories was paused from that day on. When an edit
 * gives a category-less budget categories again, its paused days from TODAY's UTC day onward are
 * cleared (past paused days stay paused). Only that empty → non-empty transition: a pause on a
 * budget that has categories is the user's own and is never touched here.
 *
 * @returns the new ranges, or null when nothing changes. PURE.
 */
function resume_on_recategorize(input) {
    var _a;
    if (input.before_category_ids.length > 0 || input.after_category_ids.length === 0)
        return null;
    const ranges = normalize_paused_ranges((_a = input.paused_ranges) !== null && _a !== void 0 ? _a : []);
    const today = utc_day(input.now_ms);
    const last = Math.max(today, ...ranges.map((r) => r.end_day));
    if (!ranges.some((r) => r.end_day >= today))
        return null;
    return apply_pause_change(ranges, today, last, false);
}
/** The longest stretch one pause call may cover (a period is at most a month). */
exports.MAX_PAUSE_DAYS = 62;
/** Bound on stored ranges (backend rule 9: every array field has a bound). */
exports.MAX_PAUSED_RANGES = 120;
/**
 * Validate and apply one pause / resume of [start, end] ("YYYY-MM-DD", inclusive) to the
 * budget's current ranges. Everything Else can't be paused (it is where paused spending goes).
 * PURE.
 */
function compute_budget_pause(input) {
    if (input.is_everything_else) {
        return { validation_errors: ["Everything Else can't be paused"] };
    }
    const a = day_from_iso(input.start_day);
    const b = day_from_iso(input.end_day);
    if (a === null || b === null)
        return { validation_errors: ["Invalid date"] };
    if (b < a)
        return { validation_errors: ["end_day is before start_day"] };
    if (b - a + 1 > exports.MAX_PAUSE_DAYS) {
        return { validation_errors: [`A pause covers one period (at most ${exports.MAX_PAUSE_DAYS} days)`] };
    }
    const next = apply_pause_change(input.current, a, b, input.paused);
    // Only a pause can be refused for the cap: Resume must always work (it may split a range).
    if (input.paused && next.length > exports.MAX_PAUSED_RANGES) {
        return { validation_errors: ["Too many separate paused stretches on this budget"] };
    }
    return { entity: next };
}
/**
 * The instants whose stored budget periods must recompute `spent` after a pause change: noon of
 * every day in [start, end] (a stored period of any cadence containing one of them). PURE.
 */
function pause_recompute_dates(start_day, end_day) {
    const a = day_from_iso(start_day);
    const b = day_from_iso(end_day);
    if (a === null || b === null || b < a)
        return [];
    const out = [];
    for (let day = a; day <= b; day++)
        out.push(day * DAY_MS + DAY_MS / 2);
    return out;
}
//# sourceMappingURL=budget_pause.service.js.map