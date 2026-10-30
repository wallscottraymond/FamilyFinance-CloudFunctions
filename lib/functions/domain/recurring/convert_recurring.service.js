"use strict";
/**
 * Convert-To-Recurring (Phase 2) — the pure heart of "Make this a bill / income".
 *
 * Everything here is deterministic and IO-free: the keys that link a vendor on an account to a
 * converted bill (D1), the schedule math (next due, first date, bounds), which past payments a
 * convert links (D2 / D46 — one per occurrence, the closest to its due date), the schedule guess
 * the preview suggests, and the record builder both convert and Add Bill / Add Income (D43) use.
 *
 * "Converted" in this module means a record created by the user through the new path:
 * `captureRulesVersion: 2` + `source: "manual"` + a stored `vendorKey` + an account. Nothing that
 * exists today carries all of them, so none of this touches an existing record (D13).
 *
 * @module domain/recurring/convert_recurring
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.utc_day_start = exports.MAX_ABSORBED_TXN_IDS = exports.MAX_ABSORBED_STREAMS = exports.D1_EARLY_PAD_MS = exports.RETRO_LINK_MONTHS = exports.CONVERT_AMOUNT_MAX = exports.CONVERT_NAME_MAX = exports.CONVERT_FREQUENCIES = void 0;
exports.converted_key = converted_key;
exports.is_converted_candidate = is_converted_candidate;
exports.parse_iso_date = parse_iso_date;
exports.cadence_ms = cadence_ms;
exports.step_cadence = step_cadence;
exports.clamp_next_due = clamp_next_due;
exports.floor_first_date = floor_first_date;
exports.occurrences_between = occurrences_between;
exports.select_retro_payments = select_retro_payments;
exports.compute_first_date = compute_first_date;
exports.guess_schedule = guess_schedule;
exports.apply_source_pin = apply_source_pin;
exports.build_converted_recurring = build_converted_recurring;
const firestore_1 = require("firebase-admin/firestore");
const outflow_period_service_1 = require("../outflows/outflow_period.service");
const capture_rules_1 = require("./capture_rules");
const late_payment_service_1 = require("./late_payment.service");
const frequency_1 = require("./frequency");
const inflow_pin_service_1 = require("./inflow_pin.service");
/** Schedules a convert / Add Bill can pick (yearly is allowed for convert, D17). */
exports.CONVERT_FREQUENCIES = [
    "weekly",
    "biweekly",
    "semimonthly",
    "monthly",
    "quarterly",
    "yearly",
];
const DAY_MS = 24 * 60 * 60 * 1000;
/** Input caps (a client value is never trusted: names and amounts are bounded). */
exports.CONVERT_NAME_MAX = 120;
exports.CONVERT_AMOUNT_MAX = 10000000;
/** D40: retro-link reaches back 12 months. */
exports.RETRO_LINK_MONTHS = 12;
/**
 * The early-payment pad (D28): a payment up to 7 days before an occurrence still pays it. The
 * engine's D1 floor and the retro-link's date floor use this one constant.
 */
exports.D1_EARLY_PAD_MS = late_payment_service_1.LATE_PAYMENT_MAX_MS;
/** Bounds on the stored lists (P12: every array has a bound). */
exports.MAX_ABSORBED_STREAMS = 20;
exports.MAX_ABSORBED_TXN_IDS = 600;
/** The key that links a payment (direction + account + vendor) to its converted bill(s). */
function converted_key(direction, account_id, vendor_key) {
    return `${direction}|${account_id}|${vendor_key}`;
}
/** A record the D1 matcher / fuzzy exclusion treats as "converted": v2 + manual + key + account. */
function is_converted_candidate(r) {
    var _a, _b;
    const v2 = r.captureRulesVersion === capture_rules_1.CAPTURE_RULES_VERSION || r.capture_rules_version === capture_rules_1.CAPTURE_RULES_VERSION;
    const key = (_a = r.vendorKey) !== null && _a !== void 0 ? _a : r.vendor_key;
    const account = (_b = r.accountId) !== null && _b !== void 0 ? _b : r.account_id;
    return v2 && r.source === "manual" && typeof key === "string" && key.length > 0 &&
        typeof account === "string" && account.length > 0;
}
// ── Schedule math ───────────────────────────────────────────────────────────
const utc_day_start = (ms) => {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
exports.utc_day_start = utc_day_start;
/** `YYYY-MM-DD` → UTC midnight ms, or null when it is not a real calendar date. */
function parse_iso_date(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m)
        return null;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const ms = Date.UTC(y, mo - 1, d);
    const back = new Date(ms);
    return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? ms : null;
}
/** Roughly one cadence in ms (for bounds and guesses only — never for placing occurrences). */
function cadence_ms(frequency) {
    switch ((0, frequency_1.normalize_frequency)(frequency)) {
        case "WEEKLY": return 7 * DAY_MS;
        case "BIWEEKLY": return 14 * DAY_MS;
        case "SEMIMONTHLY": return 15 * DAY_MS;
        case "MONTHLY": return 30 * DAY_MS;
        case "QUARTERLY": return 91 * DAY_MS;
        default: return 365 * DAY_MS;
    }
}
/** n calendar months after a UTC day, keeping its day-of-month (clamped to month end). */
function add_months(ms, n) {
    const d = new Date(ms);
    const idx = d.getUTCFullYear() * 12 + d.getUTCMonth() + n;
    const year = Math.floor(idx / 12);
    const month = ((idx % 12) + 12) % 12;
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return Date.UTC(year, month, Math.min(d.getUTCDate(), last));
}
/** The due date `n` cadences after (n > 0) or before (n < 0) `anchor_ms`, on the anchor's day. */
function step_cadence(anchor_ms, frequency, n) {
    switch ((0, frequency_1.normalize_frequency)(frequency)) {
        case "WEEKLY": return anchor_ms + n * 7 * DAY_MS;
        case "BIWEEKLY": return anchor_ms + n * 14 * DAY_MS;
        case "SEMIMONTHLY": {
            // Two fixed days a month (the anchor's and the one 15 days away); n counts payments.
            const d = new Date(anchor_ms).getUTCDate();
            const [d1, d2] = d <= 15 ? [d, d + 15] : [d - 15, d];
            const is_second = d === d2 && d !== d1;
            const slot = (is_second ? 1 : 0) + n;
            const months = Math.floor(slot / 2);
            const which = ((slot % 2) + 2) % 2;
            const base = add_months(Date.UTC(new Date(anchor_ms).getUTCFullYear(), new Date(anchor_ms).getUTCMonth(), 1), months);
            const bd = new Date(base);
            const last = new Date(Date.UTC(bd.getUTCFullYear(), bd.getUTCMonth() + 1, 0)).getUTCDate();
            return Date.UTC(bd.getUTCFullYear(), bd.getUTCMonth(), Math.min(which === 0 ? d1 : d2, last));
        }
        case "MONTHLY": return add_months(anchor_ms, n);
        case "QUARTERLY": return add_months(anchor_ms, 3 * n);
        default: return add_months(anchor_ms, 12 * n);
    }
}
/** Next due is kept in [today − 1 cadence − 7 days, today + 1 year] (period writes stay bounded). */
function clamp_next_due(next_due_ms, frequency, now_ms) {
    const today = utc_day_start(now_ms);
    const lo = today - cadence_ms(frequency) - late_payment_service_1.LATE_PAYMENT_MAX_MS;
    const hi = today + 365 * DAY_MS;
    const v = Math.min(Math.max(utc_day_start(next_due_ms), lo), hi);
    return { next_due_ms: v, clamped: v !== utc_day_start(next_due_ms) };
}
/** The first date is never earlier than now − 12 months − 1 cadence (caps stored periods ≈ 260). */
function floor_first_date(first_ms, frequency, now_ms) {
    const lo = add_months(utc_day_start(now_ms), -exports.RETRO_LINK_MONTHS) - cadence_ms(frequency);
    return Math.max(first_ms, lo);
}
/** Dates of a schedule's occurrences between two instants (anchor = next due, no first-date guard). */
function occurrences_between(frequency, next_due_ms, from_ms, to_ms) {
    const ts = (ms) => firestore_1.Timestamp.fromMillis(ms);
    return (0, outflow_period_service_1.generate_expected_occurrences_in_window)({
        frequency,
        average_amount: 1,
        first_date: ts(0),
        last_date: ts(next_due_ms),
        predicted_next_date: ts(next_due_ms),
        source: "plaid", // no "manual" start guard: the first date is what we are computing
    }, from_ms, to_ms).map((o) => o.due_date_ms).sort((a, b) => a - b);
}
const MATCH_TOLERANCE_MS = late_payment_service_1.LATE_PAYMENT_MAX_MS;
/**
 * D46: link at most ONE payment per occurrence — the one closest to its due date (ties: the
 * earlier payment, then the smaller id). A payment pays the occurrence nearest to it within 7
 * days (the earlier on a tie), exactly as the period page's matcher places it; one with no
 * occurrence in reach stays a normal transaction. The source payment (the one the user converted)
 * always counts and always claims the occurrence it pays. PURE and deterministic: the same
 * payments always give the same selection.
 */
function select_retro_payments(input) {
    var _a;
    const { frequency, next_due_ms, floor_ms } = input;
    const all = new Map();
    for (const p of input.payments)
        if (p.date_ms >= floor_ms)
            all.set(p.id, p);
    if (input.source)
        all.set(input.source.id, input.source);
    const sorted = [...all.values()].sort((a, b) => a.date_ms - b.date_ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (sorted.length === 0)
        return { chosen: [], excluded: [], first_due_ms: null };
    const lo = sorted[0].date_ms - MATCH_TOLERANCE_MS - 1;
    const hi = Math.max(sorted[sorted.length - 1].date_ms, next_due_ms) + MATCH_TOLERANCE_MS + 1;
    const dues = occurrences_between(frequency, next_due_ms, lo, hi);
    // Only occurrences inside the window (on or after the floor, already due) can be linked to: a
    // payment just after the floor that pays an occurrence before it belongs to history we don't
    // reach (D40 / D45), and a past payment never claims an occurrence that isn't due yet (only the
    // source — the payment the user tapped — may be early).
    // One exception (an early payment): the NEXT occurrence, if it falls due within the early pad,
    // may be claimed by a payment already made (dated ≤ now) — at most that one occurrence.
    const first_future = dues.filter((d) => d > input.now_ms).reduce((m, d) => (m === null || d < m ? d : m), null);
    const early_ok = first_future !== null && first_future <= input.now_ms + exports.D1_EARLY_PAD_MS;
    const nearest = (date_ms, in_window_only) => {
        let best = null;
        let best_diff = Infinity;
        for (const d of dues) {
            if (in_window_only) {
                if (d < floor_ms)
                    continue;
                if (d > input.now_ms && !(early_ok && d === first_future && date_ms <= input.now_ms))
                    continue;
            }
            const diff = Math.abs(date_ms - d);
            if (diff <= MATCH_TOLERANCE_MS && diff < best_diff) {
                best = d;
                best_diff = diff;
            }
        }
        return best;
    };
    const by_due = new Map();
    const unmatched = [];
    const better = (a, b, due) => {
        const da = Math.abs(a.date_ms - due);
        const db = Math.abs(b.date_ms - due);
        if (da !== db)
            return da < db;
        if (a.date_ms !== b.date_ms)
            return a.date_ms < b.date_ms;
        return a.id < b.id;
    };
    const source_id = (_a = input.source) === null || _a === void 0 ? void 0 : _a.id;
    for (const p of sorted) {
        const due = nearest(p.date_ms, p.id !== source_id);
        if (due === null) {
            unmatched.push(p);
            continue;
        }
        const cur = by_due.get(due);
        if (!cur) {
            by_due.set(due, p);
        }
        else if (cur.id === source_id) {
            // the source keeps the occurrence it pays
        }
        else if (p.id === source_id || better(p, cur, due)) {
            by_due.set(due, p);
        }
    }
    const chosen_set = new Set([...by_due.values()].map((p) => p.id));
    // The source is always linked (it is pinned), whether or not an occurrence is in reach.
    if (input.source)
        chosen_set.add(input.source.id);
    const chosen = sorted.filter((p) => chosen_set.has(p.id));
    const excluded = sorted.filter((p) => !chosen_set.has(p.id));
    const matched_dues = [...by_due.keys()].sort((a, b) => a - b);
    void unmatched;
    return { chosen, excluded, first_due_ms: matched_dues.length > 0 ? matched_dues[0] : null };
}
/**
 * The record's first date: the earliest occurrence a linked payment pays (so it reads paid, never
 * "unpaid" before its first real payment), never later than the next due and never earlier than
 * the 12-month floor. With no payment in reach of an occurrence it is the last occurrence at or
 * before the source payment (else the next due).
 */
function compute_first_date(input) {
    let first = input.selection.first_due_ms;
    if (first === null) {
        const dues = occurrences_between(input.frequency, input.next_due_ms, input.source_date_ms - 400 * DAY_MS, input.next_due_ms);
        const at_or_before = dues.filter((d) => d <= input.source_date_ms);
        first = at_or_before.length > 0 ? at_or_before[at_or_before.length - 1] : input.next_due_ms;
    }
    return Math.min(floor_first_date(first, input.frequency, input.now_ms), input.next_due_ms);
}
const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** Guess the schedule from payment dates (median gap → cadence). null when there is no pattern. */
function guess_schedule(dates_ms, now_ms) {
    const days = [...new Set(dates_ms.map(utc_day_start))].sort((a, b) => a - b);
    if (days.length < 2)
        return null;
    const gaps = days.slice(1).map((d, i) => Math.round((d - days[i]) / DAY_MS));
    const g = median(gaps);
    let frequency = null;
    if (g >= 5 && g <= 9)
        frequency = "weekly";
    else if (g >= 12 && g <= 16) {
        // Two fixed days a month (1st + 15th) gaps alternate 14/15/16/17; every 2 weeks stays 14.
        frequency = gaps.every((x) => x >= 13 && x <= 17) && new Set(gaps).size > 2 ? "semimonthly" : "biweekly";
    }
    else if (g >= 17 && g <= 19)
        frequency = "semimonthly";
    else if (g >= 27 && g <= 34)
        frequency = "monthly";
    else if (g >= 85 && g <= 100)
        frequency = "quarterly";
    else if (g >= 350 && g <= 380)
        frequency = "yearly";
    if (!frequency)
        return null;
    const last = days[days.length - 1];
    const today = utc_day_start(now_ms);
    let n = 1;
    let next = step_cadence(last, frequency, n);
    while (next < today && n < 800) {
        n++;
        next = step_cadence(last, frequency, n);
    }
    return { frequency, median_gap_days: g, next_due_ms: next };
}
/**
 * Pin the source split to the new record (pure). A bill is pinned like the manual bill pin; an
 * income like the manual income pin (`apply_inflow_pin_to_split`). A "remove from bill" detach on
 * the split is replaced: converting is the user's explicit choice.
 */
function apply_source_pin(split, direction, id) {
    if (direction === "inflow")
        return (0, inflow_pin_service_1.apply_inflow_pin_to_split)(split, id);
    /* eslint-disable @typescript-eslint/naming-convention */
    return Object.assign(Object.assign({}, split), { outflowId: id, outflowAssignmentSource: "manual", outflowPinnedPeriodId: null, inflowId: null, suspendedOutflowPinId: null });
    /* eslint-enable @typescript-eslint/naming-convention */
}
/** App frequency spelling stored on the record (Plaid-style lowercase; derive normalizes it). */
const stored_frequency = (f) => (f === "yearly" ? "yearly" : f);
/** Validate and build the record to persist. PURE. */
function build_converted_recurring(input) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const errors = [];
    const name = input.name.trim();
    if (name.length === 0)
        errors.push("A name is required");
    if (name.length > exports.CONVERT_NAME_MAX)
        errors.push(`The name can be at most ${exports.CONVERT_NAME_MAX} characters`);
    if (!(input.amount > 0) || !Number.isFinite(input.amount))
        errors.push("The amount must be greater than zero");
    if (input.amount > exports.CONVERT_AMOUNT_MAX)
        errors.push("The amount is too large");
    if (!exports.CONVERT_FREQUENCIES.includes(input.frequency))
        errors.push("Pick a schedule");
    if (errors.length > 0)
        return { errors };
    const first = new Date(input.first_date_ms);
    const next = new Date(input.next_due_ms);
    const key = input.vendor_key && input.vendor_key.length > 0 ? input.vendor_key : null;
    const merchant = ((_a = input.merchant_source) === null || _a === void 0 ? void 0 : _a.trim()) || name;
    const common = Object.assign(Object.assign(Object.assign(Object.assign({ id: input.id, owner_id: input.user_id, created_by: input.user_id, updated_by: input.user_id, group_ids: [], 
        // Not from Plaid: no item / stream, so Plaid sync and stale-marking (item-scoped) never touch it.
        plaid_item_id: "", plaid_stream_id: input.id, account_id: input.account_id, last_amount: input.amount, average_amount: input.amount, currency: "USD", description: (_b = input.description) !== null && _b !== void 0 ? _b : name, user_custom_name: name, frequency: stored_frequency(input.frequency), first_date: first, last_date: next, predicted_next_date: next, plaid_primary_category: (_c = input.plaid_primary_category) !== null && _c !== void 0 ? _c : "GENERAL_SERVICES", plaid_detailed_category: (_d = input.plaid_detailed_category) !== null && _d !== void 0 ? _d : "GENERAL_SERVICES_OTHER_GENERAL_SERVICES", internal_primary_category: null, internal_detailed_category: null, status: "active", source: "manual", plaid_status: "MANUAL", plaid_confidence_level: null, is_active: true, is_hidden: input.is_hidden === true, is_user_modified: (_e = input.is_user_modified) !== null && _e !== void 0 ? _e : true, transaction_ids: [], tags: [], rules: [], capture_rules_version: capture_rules_1.CAPTURE_RULES_VERSION, plaid_is_active: true }, (key ? { vendor_key: key } : {})), (input.converted_from_txn_id ? { converted_from_txn_id: input.converted_from_txn_id } : {})), (((_f = input.converted_from_split_ids) === null || _f === void 0 ? void 0 : _f.length) ? { converted_from_split_ids: input.converted_from_split_ids } : {})), { 
        // the exact instant (a payment CREATED after it, but dated earlier, is a late arrival — A); the D1
        // floor is this instant's UTC day.
        converted_at_ms: input.now_ms, 
        // The average never drifts what the user typed: the override pins the expected amount.
        expected_amount_override: input.expected_amount_override === undefined ? input.amount : input.expected_amount_override });
    if (input.direction === "outflow") {
        return {
            outflow: Object.assign(Object.assign({}, common), { merchant_name: merchant, expense_type: (_g = input.expense_type) !== null && _g !== void 0 ? _g : "other", is_essential: (_h = input.is_essential) !== null && _h !== void 0 ? _h : false }),
        };
    }
    return {
        inflow: Object.assign(Object.assign(Object.assign({}, common), { payer_name: merchant, income_type: (_j = input.income_type) !== null && _j !== void 0 ? _j : "other", is_regular_salary: (_k = input.is_regular_salary) !== null && _k !== void 0 ? _k : false, is_variable: (_l = input.is_variable) !== null && _l !== void 0 ? _l : false }), (input.income_extras ? { income_extras: input.income_extras } : {})),
    };
}
//# sourceMappingURL=convert_recurring.service.js.map