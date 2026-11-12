"use strict";
/**
 * Income Parts Domain Service (Income-Detail-Screen, Phase 1)
 *
 * A paycheck is a list of PARTS (base, commission, reimbursement, ...). This module is the one
 * rule for what each part of a check is:
 *   - which parts apply to a check (schedule: every / end_of_month / months),
 *   - a part's history from the deposits received (labelled split, else the default split),
 *   - a part's plan amount (set / avg / typical / careful / none),
 *   - per-check overrides and one-off extras (`occurrence_parts`),
 *   - the breakdown of a RECEIVED check (the bank total is fixed; the parts add up to it).
 *
 * PURE: no IO, no clock. History is "the last 12 months" relative to a reference date derived
 * from the data (the check's own date, capped at the newest deposit), never `Date.now()`.
 *
 * @module domain/recurring/income_parts
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OCCURRENCE_PARTS_KEEP_MONTHS = exports.MAX_INCOME_PARTS = exports.DEFAULT_FORECAST_SETTINGS = void 0;
exports.parse_income_parts = parse_income_parts;
exports.parse_forecast_settings = parse_forecast_settings;
exports.parse_occurrence_parts = parse_occurrence_parts;
exports.is_stale_occurrence_parts_key = is_stale_occurrence_parts_key;
exports.months_before = months_before;
exports.make_is_last_of_month = make_is_last_of_month;
exports.part_applies = part_applies;
exports.received_check_parts = received_check_parts;
exports.make_history_is_last = make_history_is_last;
exports.compute_part_stats = compute_part_stats;
exports.make_expected_parts_calculator = make_expected_parts_calculator;
exports.sum_parts = sum_parts;
exports.sum_sure_parts = sum_sure_parts;
const manual_settlement_service_1 = require("./manual_settlement.service");
exports.DEFAULT_FORECAST_SETTINGS = { careful_months: 6, careful_rule: "lowest" };
exports.MAX_INCOME_PARTS = 8;
/** `occurrence_parts` keys older than this are dropped when carried (months). */
exports.OCCURRENCE_PARTS_KEEP_MONTHS = 24;
const MS_PER_DAY = 86400000;
/** A deposit's own date may sit a few days from the check's due date. */
const LABEL_MATCH_DAYS = 3;
const PART_KINDS = new Set([
    "base", "commission", "bonus", "overtime", "tips", "reimbursement", "stock", "income", "custom",
]);
const SCHEDULES = new Set(["every", "end_of_month", "months"]);
const PLANS = new Set(["set", "avg", "typical", "careful", "none"]);
function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}
function is_obj(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
function finite(v) {
    return typeof v === "number" && Number.isFinite(v);
}
/* ------------------------------------------------------------------------------------------ */
/* Defensive parsing (Firestore doc, camelCase  ->  domain, snake_case)                         */
/* ------------------------------------------------------------------------------------------ */
/** Parse `incomeParts`: malformed entries are dropped; max 8; at most one `takesRest`. */
function parse_income_parts(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    const seen = new Set();
    let has_rest = false;
    for (const e of raw) {
        if (out.length >= exports.MAX_INCOME_PARTS)
            break;
        if (!is_obj(e))
            continue;
        const id = typeof e.id === "string" ? e.id.trim() : "";
        if (!id || seen.has(id))
            continue;
        if (typeof e.kind !== "string" || !PART_KINDS.has(e.kind))
            continue;
        if (typeof e.schedule !== "string" || !SCHEDULES.has(e.schedule))
            continue;
        if (typeof e.plan !== "string" || !PLANS.has(e.plan))
            continue;
        const part = {
            id,
            kind: e.kind,
            schedule: e.schedule,
            plan: e.plan,
        };
        if (typeof e.label === "string" && e.label.trim())
            part.label = e.label.trim().slice(0, 60);
        if (part.schedule === "months") {
            const months = Array.isArray(e.months)
                ? [...new Set(e.months.filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))]
                : [];
            if (months.length === 0)
                continue; // a "months" part with no months can never apply
            part.months = months.sort((a, b) => a - b);
        }
        if (finite(e.amount) && e.amount >= 0)
            part.amount = e.amount;
        if (e.takesRest === true && !has_rest) {
            part.takes_rest = true;
            has_rest = true;
        }
        seen.add(id);
        out.push(part);
    }
    return out;
}
/** Parse `forecastSettings`; anything unusable falls back to the default (6 months, lowest). */
function parse_forecast_settings(raw) {
    if (!is_obj(raw))
        return Object.assign({}, exports.DEFAULT_FORECAST_SETTINGS);
    const months = raw.carefulMonths === 3 || raw.carefulMonths === 6 || raw.carefulMonths === 12
        ? raw.carefulMonths
        : exports.DEFAULT_FORECAST_SETTINGS.careful_months;
    const rule = raw.carefulRule === "low_end" ? "low_end" : "lowest";
    return { careful_months: months, careful_rule: rule };
}
/** Parse `occurrenceParts` (keys must be `YYYY-MM-DD`; malformed entries are dropped). */
function parse_occurrence_parts(raw) {
    const out = {};
    if (!is_obj(raw))
        return out;
    for (const [key, list] of Object.entries(raw)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Array.isArray(list))
            continue;
        const entries = [];
        for (const e of list.slice(0, exports.MAX_INCOME_PARTS * 2)) {
            if (!is_obj(e) || !finite(e.amount) || e.amount < 0)
                continue;
            const kind = typeof e.kind === "string" && PART_KINDS.has(e.kind) ? e.kind : null;
            const part_id = typeof e.partId === "string" && e.partId ? e.partId : undefined;
            if (!kind && !part_id)
                continue;
            entries.push(Object.assign(Object.assign(Object.assign(Object.assign({}, (part_id ? { part_id } : {})), { kind: kind !== null && kind !== void 0 ? kind : "custom" }), (typeof e.label === "string" && e.label.trim() ? { label: e.label.trim().slice(0, 60) } : {})), { amount: e.amount }));
        }
        if (entries.length > 0)
            out[key] = entries;
    }
    return out;
}
/** True for a raw `occurrenceParts` key older than `keep_months` before `now_ms` (UTC). */
function is_stale_occurrence_parts_key(key, now_ms, keep_months = exports.OCCURRENCE_PARTS_KEEP_MONTHS) {
    const ms = Date.parse(`${key}T00:00:00.000Z`);
    if (!Number.isFinite(ms))
        return false; // unknown key: leave it, don't guess
    return ms < months_before(now_ms, keep_months);
}
/* ------------------------------------------------------------------------------------------ */
/* Calendar helpers (UTC)                                                                       */
/* ------------------------------------------------------------------------------------------ */
/** First / last ms of `ms`'s UTC month. */
function month_start(ms) {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}
function month_end(ms) {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 1;
}
function month_index(ms) {
    const d = new Date(ms);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
}
/** `ms` minus `n` calendar months (UTC), day clamped to the month's length. */
function months_before(ms, n) {
    const d = new Date(ms);
    const target_first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1);
    const t = new Date(target_first);
    const len = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    const day = Math.min(d.getUTCDate(), len);
    const time_of_day = ms - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return target_first + (day - 1) * MS_PER_DAY + time_of_day;
}
/** Builds "is this date the LAST check of its UTC month?" over the known check dates. */
function make_is_last_of_month(dates_ms) {
    var _a;
    const last = new Map();
    for (const ms of dates_ms) {
        const k = month_index(ms);
        if (((_a = last.get(k)) !== null && _a !== void 0 ? _a : -Infinity) < ms)
            last.set(k, ms);
    }
    return (ms) => {
        const l = last.get(month_index(ms));
        return l === undefined || l <= ms;
    };
}
/** Whether `part` applies to a check on `ms`. */
function part_applies(part, ms, is_last_of_month) {
    var _a;
    if (part.schedule === "every")
        return true;
    if (part.schedule === "end_of_month")
        return is_last_of_month;
    return ((_a = part.months) !== null && _a !== void 0 ? _a : []).includes(new Date(ms).getUTCMonth() + 1);
}
/** The labelled entries for a check: exact date key, else the nearest key within 3 days. */
function find_labelled(map, date_ms) {
    if (!map)
        return undefined;
    const exact = map[(0, manual_settlement_service_1.occurrence_date_key)(date_ms)];
    if (exact === null || exact === void 0 ? void 0 : exact.length)
        return exact;
    let best;
    let best_diff = LABEL_MATCH_DAYS * MS_PER_DAY + 1;
    for (const [key, list] of Object.entries(map)) {
        const ms = Date.parse(`${key}T00:00:00.000Z`);
        if (!Number.isFinite(ms) || !list.length)
            continue;
        const diff = Math.abs(ms - date_ms);
        if (diff < best_diff) {
            best_diff = diff;
            best = list;
        }
    }
    return best;
}
/**
 * Split a received deposit into parts. Labelled split when given (the takesRest part absorbs the
 * gap, floored at 0), else the default rule: `set` parts take min(amount, what's left) in part
 * order, the takesRest part gets the remainder, everything else 0. Never below 0.
 */
function split_deposit(parts, total, date_ms, is_last, labelled) {
    var _a, _b;
    const by_part = new Map();
    const present = new Set();
    const extras = [];
    const total_pos = Math.max(total, 0);
    const rest = parts.find((p) => p.takes_rest);
    if (labelled && labelled.length > 0) {
        let assigned = 0;
        for (const e of labelled) {
            if (e.part_id && parts.some((p) => p.id === e.part_id)) {
                if (rest && e.part_id === rest.id) {
                    present.add(rest.id);
                    continue; // recomputed below: the rest part absorbs the gap
                }
                by_part.set(e.part_id, ((_a = by_part.get(e.part_id)) !== null && _a !== void 0 ? _a : 0) + e.amount);
                present.add(e.part_id);
                assigned += e.amount;
            }
            else if (!e.part_id) {
                extras.push(e);
                assigned += e.amount;
            }
        }
        if (rest && (part_applies(rest, date_ms, is_last) || present.has(rest.id))) {
            by_part.set(rest.id, Math.max(total_pos - assigned, 0));
            present.add(rest.id);
        }
        return { by_part, extras, present };
    }
    let remaining = total_pos;
    for (const p of parts) {
        if (!part_applies(p, date_ms, is_last))
            continue;
        present.add(p.id);
        if (p.takes_rest)
            continue;
        if (p.plan === "set") {
            const take = Math.min((_b = p.amount) !== null && _b !== void 0 ? _b : 0, remaining);
            by_part.set(p.id, take);
            remaining -= take;
        }
        else {
            by_part.set(p.id, 0);
        }
    }
    if (rest && present.has(rest.id))
        by_part.set(rest.id, Math.max(remaining, 0));
    return { by_part, extras, present };
}
/** The breakdown of a RECEIVED check (every part "sure": the deposit is a fact). */
function received_check_parts(input) {
    var _a;
    const labelled = find_labelled(input.occurrence_parts, input.date_ms);
    const s = split_deposit(input.parts, input.amount, input.date_ms, input.is_last_of_month, labelled);
    const out = [];
    for (const p of input.parts) {
        if (!s.present.has(p.id))
            continue;
        out.push(make_part(p, round2((_a = s.by_part.get(p.id)) !== null && _a !== void 0 ? _a : 0), true));
    }
    for (const e of s.extras)
        out.push(Object.assign(Object.assign({ kind: e.kind }, (e.label ? { label: e.label } : {})), { amount: round2(e.amount), sure: true }));
    return out;
}
function make_part(p, amount, sure) {
    return Object.assign(Object.assign({ part_id: p.id, kind: p.kind }, (p.label ? { label: p.label } : {})), { amount, sure });
}
function median(sorted) {
    const n = sorted.length;
    if (n === 0)
        return 0;
    const mid = Math.floor(n / 2);
    return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
/** 25th percentile, nearest-rank. */
function low_end(sorted) {
    if (sorted.length === 0)
        return 0;
    return sorted[Math.max(Math.ceil(0.25 * sorted.length) - 1, 0)];
}
function stats_from(points, ref_ms, settings) {
    // points: last 12 months, newest first.
    if (points.length === 0)
        return { avg: 0, typical: 0, careful: 0 };
    const recent3 = points.slice(0, 3).map((p) => p.value);
    const avg = recent3.reduce((a, b) => a + b, 0) / recent3.length;
    const typical = median(points.map((p) => p.value).sort((a, b) => a - b));
    const since = months_before(ref_ms, settings.careful_months);
    const window = points.filter((p) => p.date_ms >= since).map((p) => p.value).sort((a, b) => a - b);
    const careful = window.length === 0 ? 0 : settings.careful_rule === "low_end" ? low_end(window) : window[0];
    return { avg: round2(avg), typical: round2(typical), careful: round2(careful) };
}
/** A deposit can be ~this far from its scheduled date (weekends, holidays). */
const LAST_CHECK_SLACK_MS = 5 * MS_PER_DAY;
/**
 * "Was this deposit the month's last check?" for history: it's the month's last deposit AND no
 * scheduled check falls later that month (beyond the slack). Without this, the mid-month base
 * check counts as "last" while the month-end check is still to come (or missing), and the
 * end-of-month part (commission) gets a ~$0 history point.
 */
function make_history_is_last(deposit_dates_ms, scheduled_dates_ms) {
    var _a;
    const last_deposit = make_is_last_of_month(deposit_dates_ms);
    const last_sched = new Map();
    for (const ms of scheduled_dates_ms) {
        const k = month_index(ms);
        if (((_a = last_sched.get(k)) !== null && _a !== void 0 ? _a : -Infinity) < ms)
            last_sched.set(k, ms);
    }
    return (ms) => {
        if (!last_deposit(ms))
            return false;
        const s = last_sched.get(month_index(ms));
        return s === undefined || s <= ms + LAST_CHECK_SLACK_MS;
    };
}
/** History points per part id, as of `ref_ms` (deposits in [ref - 12 months, ref), newest first). */
function history_by_part(inp, ref_ms) {
    var _a, _b;
    const since = months_before(ref_ms, 12);
    const window = inp.deposits
        .filter((d) => d.date_ms >= since && d.date_ms < ref_ms)
        .sort((a, b) => b.date_ms - a.date_ms);
    const sched = inp.check_dates ? inp.check_dates(month_start(since), month_end(ref_ms)) : [];
    const is_last = make_history_is_last(window.map((d) => d.date_ms), sched);
    const out = new Map();
    for (const p of inp.parts)
        out.set(p.id, []);
    for (const d of window) {
        const s = split_deposit(inp.parts, d.amount, d.date_ms, is_last(d.date_ms), find_labelled(inp.occurrence_parts, d.date_ms));
        for (const id of s.present)
            (_a = out.get(id)) === null || _a === void 0 ? void 0 : _a.push({ date_ms: d.date_ms, value: (_b = s.by_part.get(id)) !== null && _b !== void 0 ? _b : 0 });
    }
    return out;
}
/** Reference date for history: the check's own date, capped just past the newest deposit. */
function history_ref(inp, due_ms) {
    let newest = -Infinity;
    for (const d of inp.deposits)
        if (d.date_ms > newest)
            newest = d.date_ms;
    return Math.min(due_ms, newest + 1);
}
/** Avg / typical / careful dollar amount for every part (so the plan screen can show each choice). */
function compute_part_stats(inp) {
    var _a;
    if (inp.parts.length === 0)
        return [];
    const ref = history_ref(inp, Number.POSITIVE_INFINITY);
    const settings = (_a = inp.settings) !== null && _a !== void 0 ? _a : exports.DEFAULT_FORECAST_SETTINGS;
    const hist = Number.isFinite(ref) ? history_by_part(inp, ref) : new Map();
    return inp.parts.map((p) => {
        var _a;
        return (Object.assign({ part_id: p.id }, stats_from((_a = hist.get(p.id)) !== null && _a !== void 0 ? _a : [], Number.isFinite(ref) ? ref : 0, settings)));
    });
}
/**
 * Builds a calculator for the EXPECTED parts of an outstanding check on `due_ms`. Stats are
 * memoised per reference date. A part override (`occurrence_parts` entry with the part's id)
 * replaces its planned amount (and is "sure"); entries without an id are one-off extras (sure).
 */
function make_expected_parts_calculator(inp, is_last_of_month) {
    var _a;
    const settings = (_a = inp.settings) !== null && _a !== void 0 ? _a : exports.DEFAULT_FORECAST_SETTINGS;
    const memo = new Map();
    const stats_at = (ref) => {
        var _a;
        const hit = memo.get(ref);
        if (hit)
            return hit;
        const hist = Number.isFinite(ref) ? history_by_part(inp, ref) : new Map();
        const m = new Map();
        for (const p of inp.parts)
            m.set(p.id, stats_from((_a = hist.get(p.id)) !== null && _a !== void 0 ? _a : [], ref, settings));
        memo.set(ref, m);
        return m;
    };
    return (due_ms) => {
        var _a, _b, _c;
        const key = (0, manual_settlement_service_1.occurrence_date_key)(due_ms);
        const entries = (_b = (_a = inp.occurrence_parts) === null || _a === void 0 ? void 0 : _a[key]) !== null && _b !== void 0 ? _b : [];
        const last = is_last_of_month(due_ms);
        const stats = stats_at(history_ref(inp, due_ms));
        const out = [];
        for (const p of inp.parts) {
            const override = entries.find((e) => e.part_id === p.id);
            if (override) {
                out.push(make_part(p, round2(override.amount), true));
                continue;
            }
            if (!part_applies(p, due_ms, last))
                continue;
            const st = stats.get(p.id);
            const amount = p.plan === "set" ? (_c = p.amount) !== null && _c !== void 0 ? _c : 0
                : p.plan === "none" ? 0
                    : p.plan === "avg" ? st.avg
                        : p.plan === "typical" ? st.typical
                            : st.careful;
            out.push(make_part(p, round2(amount), p.plan === "set"));
        }
        for (const e of entries) {
            if (e.part_id)
                continue;
            out.push(Object.assign(Object.assign({ kind: e.kind }, (e.label ? { label: e.label } : {})), { amount: round2(e.amount), sure: true }));
        }
        return out;
    };
}
/** Sum of a check's part amounts. */
function sum_parts(parts) {
    return round2(parts.reduce((a, p) => a + p.amount, 0));
}
/** Sum of the parts you can count on. */
function sum_sure_parts(parts) {
    return round2(parts.filter((p) => p.sure).reduce((a, p) => a + p.amount, 0));
}
//# sourceMappingURL=income_parts.service.js.map