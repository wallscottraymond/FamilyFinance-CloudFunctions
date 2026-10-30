"use strict";
/**
 * "Possible bill" detector (Convert-To-Recurring D11 / D17 / X12 / X14 / X17) — PURE.
 *
 * Finds payments Plaid never made a bill from (Avant: irregular amounts and dates) in the
 * transactions the transfer classifier already loaded (~180 days — X12: no extra transaction read),
 * and proposes ONE `suggested` item per (direction, vendor) — the same subject a Plaid suggestion
 * uses, so a vendor never gets two tiles (X14).
 *
 * Only transactions NOT already accounted for: not in any bill / income stream (active, hidden or
 * inactive), not held out (a Plaid suggestion or a "Not a bill"), not linked to a bill / income by a
 * split, not an internal transfer or edge money, posted, the user's own.
 *
 * Gates:
 *   - rhythm: ≥ 3 payments, average gap ≥ 6 days, and the gaps fit ONE schedule — weekly,
 *     every 2 weeks, twice a month or monthly (no quarterly / yearly in Phase 1: too few samples
 *     in ~180 days, and yearly comes from Plaid or the convert button — D17); still going (the last
 *     payment within two cycles of now);
 *   - category: bills = clearly bill-like (rent & utilities, loans, insurance, medical, government);
 *     entertainment, personal care, transportation, food, shopping, travel and person-to-person
 *     transfers are skipped (D17). Income = `INCOME_*` only, never on a credit / loan account (X17);
 *   - memory: a vendor the user said "Not a bill" about is never suggested (D11); a vendor that
 *     already has a bill / income record isn't either; an item the user already answered, or a
 *     Plaid-sourced open item, is left alone (one tile per vendor).
 *
 * @module domain/recurring/recurring_detector
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DETECTOR_CADENCES = exports.MIN_AVG_GAP_DAYS = exports.MIN_PAYMENTS = exports.DETECTOR_TXN_CAP = void 0;
exports.is_bill_like_category = is_bill_like_category;
exports.is_income_category = is_income_category;
exports.fit_cadence = fit_cadence;
exports.detect_candidates = detect_candidates;
exports.detector_items = detector_items;
const vendor_key_service_1 = require("../transactions/vendor_key.service");
const capture_rules_1 = require("./capture_rules");
const review_item_service_1 = require("./review_item.service");
const DAY = 24 * 60 * 60 * 1000;
/** At most this many of the most recent transactions are considered (bound; logged when hit). */
exports.DETECTOR_TXN_CAP = 5000;
exports.MIN_PAYMENTS = 3;
exports.MIN_AVG_GAP_DAYS = 6;
/** A schedule the detector may propose: nominal gap + accepted gap band (days). */
exports.DETECTOR_CADENCES = [
    { frequency: "weekly", nominal: 7, min: 5, max: 9 },
    { frequency: "biweekly", nominal: 14, min: 12, max: 16 },
    { frequency: "semimonthly", nominal: 15, min: 10, max: 20 },
    { frequency: "monthly", nominal: 30, min: 25, max: 36 },
];
const BILL_PRIMARY = new Set(["RENT_AND_UTILITIES", "LOAN_PAYMENTS", "MEDICAL", "GOVERNMENT_AND_NON_PROFIT"]);
const BILL_DETAILED = new Set(["GENERAL_SERVICES_INSURANCE"]);
/** Bill-like category (D11 / D17). */
function is_bill_like_category(detailed) {
    const d = String(detailed !== null && detailed !== void 0 ? detailed : "").toUpperCase();
    if (BILL_DETAILED.has(d))
        return true;
    for (const p of BILL_PRIMARY)
        if (d.startsWith(`${p}_`) || d === p)
            return true;
    return false;
}
/** Income category for the income side (X17). */
function is_income_category(detailed) {
    return String(detailed !== null && detailed !== void 0 ? detailed : "").toUpperCase().startsWith("INCOME_");
}
/** UTC-normalized day number (CLAUDE.md day counting). */
const utc_day_n = (ms) => {
    const d = new Date(ms);
    return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY);
};
/** The schedule a sorted list of payment dates fits, or null (all gaps in one band). PURE. */
function fit_cadence(dates_ms) {
    if (dates_ms.length < exports.MIN_PAYMENTS)
        return null;
    const days = [...dates_ms].sort((a, b) => a - b).map(utc_day_n);
    const gaps = days.slice(1).map((d, i) => d - days[i]);
    if (gaps.some((g) => g <= 0))
        return null; // two on one day → not a bill rhythm
    const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    if (avg < exports.MIN_AVG_GAP_DAYS)
        return null;
    for (const c of exports.DETECTOR_CADENCES) {
        if (gaps.every((g) => g >= c.min && g <= c.max))
            return c;
    }
    return null;
}
const split_linked = (data) => {
    var _a;
    return ((_a = data.splits) !== null && _a !== void 0 ? _a : []).some((s) => !!s.outflowId || !!s.inflowId);
};
/**
 * Step 1 — candidate vendors (no review-item knowledge yet; the caller then `getAll`s their ids).
 * Returns whether the transaction cap was hit (for the log).
 */
function detect_candidates(input) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const sorted = [...input.txns].sort((a, b) => ms_of(b.data.transactionDate) - ms_of(a.data.transactionDate));
    const capped = sorted.length > exports.DETECTOR_TXN_CAP;
    const pool = sorted.slice(0, exports.DETECTOR_TXN_CAP);
    const groups = new Map();
    for (const t of pool) {
        const d = t.data;
        if (((_a = d.userId) !== null && _a !== void 0 ? _a : d.ownerId) !== input.user_id)
            continue;
        if (d.isPending === true || d.isActive === false)
            continue;
        if (input.internal_txn_ids.has(t.id))
            continue;
        if (d.transferRole === "edge_out" || d.transferRole === "edge_in")
            continue;
        const plaid_id = (_b = d.transactionId) !== null && _b !== void 0 ? _b : null;
        if (plaid_id && (input.record_txn_ids.has(plaid_id) || ((_c = input.state) === null || _c === void 0 ? void 0 : _c.suppressed_txn_ids.includes(plaid_id))))
            continue;
        if (split_linked(d))
            continue;
        const type = String((_d = d.type) !== null && _d !== void 0 ? _d : "");
        const direction = type === "expense" ? "outflow" : type === "income" ? "inflow" : null;
        if (!direction)
            continue;
        const detailed = String((_e = d.plaidDetailedCategory) !== null && _e !== void 0 ? _e : "");
        if (direction === "outflow" ? !is_bill_like_category(detailed) : !is_income_category(detailed))
            continue;
        const vendor = (typeof d.vendorKey === "string" && d.vendorKey) ||
            (0, vendor_key_service_1.vendor_key)({
                merchant_name: d.merchantName,
                name: d.name,
                description: d.description,
            });
        if (!vendor)
            continue;
        const key = (0, review_item_service_1.suggested_subject)(direction, vendor);
        if (!groups.has(key))
            groups.set(key, { direction, vendor, txns: [] });
        groups.get(key).txns.push(t);
    }
    const candidates = [];
    let needs_account_types = false;
    for (const [subject, g] of groups) {
        if (input.record_vendor_subjects.has(subject))
            continue; // a record already covers this vendor
        if ((0, review_item_service_1.is_vendor_dismissed)(input.state, g.direction, g.vendor))
            continue; // "Not a bill" (D11)
        const dates = g.txns.map((t) => ms_of(t.data.transactionDate));
        const cadence = fit_cadence(dates);
        if (!cadence)
            continue;
        const last = Math.max(...dates);
        if (input.now_ms - last > 2 * cadence.nominal * DAY)
            continue; // stopped — not a live bill
        const account_counts = new Map();
        for (const t of g.txns) {
            const a = String((_f = t.data.accountId) !== null && _f !== void 0 ? _f : "");
            account_counts.set(a, ((_g = account_counts.get(a)) !== null && _g !== void 0 ? _g : 0) + 1);
        }
        const account_id = [...account_counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
        if (g.direction === "inflow") {
            if (!input.account_types) {
                needs_account_types = true;
                continue;
            }
            if ((0, capture_rules_1.is_credit_or_loan_account)(input.account_types.get(account_id)))
                continue; // X17
        }
        const amounts = g.txns.map((t) => { var _a; return Math.abs(Number((_a = t.data.amount) !== null && _a !== void 0 ? _a : 0)); }).sort((a, b) => a - b);
        const median = amounts[Math.floor(amounts.length / 2)];
        const newest = [...g.txns].sort((a, b) => ms_of(a.data.transactionDate) - ms_of(b.data.transactionDate));
        candidates.push({
            direction: g.direction,
            vendor_key: g.vendor,
            subject_key: subject,
            item_id: (0, review_item_service_1.build_review_item_id)(input.user_id, "suggested", subject),
            name: newest[newest.length - 1].data.merchantName || newest[newest.length - 1].data.name || g.vendor,
            amount: Math.round(median * 100) / 100,
            frequency: cadence.frequency,
            next_due_ms: last + cadence.nominal * DAY,
            account_id,
            category: String((_h = newest[newest.length - 1].data.plaidDetailedCategory) !== null && _h !== void 0 ? _h : ""),
            transaction_ids: newest.map((t) => t.id),
            payments: g.txns.length,
        });
    }
    candidates.sort((a, b) => (a.subject_key < b.subject_key ? -1 : 1));
    return { candidates, capped, needs_account_types };
}
/**
 * Step 2 — the items to write: a new open detector item per candidate, or a refresh of the
 * detector's own open item. Never touches an answered item or a Plaid-sourced one (X14). PURE.
 */
function detector_items(user_id, now_ms, candidates, existing) {
    const out = [];
    for (const c of candidates) {
        const ex = existing.get(c.item_id);
        if (ex && (ex.status !== "open" || ex.source !== "detector"))
            continue;
        const item = (0, review_item_service_1.make_review_item)({
            user_id,
            kind: "suggested",
            direction: c.direction,
            source: "detector",
            status: "open",
            answer: null,
            subject_key: c.subject_key,
            vendor_key: c.vendor_key,
            account_id: c.account_id,
            plaid_item_doc_id: null,
            stream_id: null,
            record_id: null,
            name: c.name,
            amount: c.amount,
            frequency: c.frequency,
            plaid_status: null,
            category: c.category,
            transaction_ids: c.transaction_ids,
            next_due_ms: c.next_due_ms,
            user_frequency: null,
            resolved_at_ms: null,
        }, now_ms, ex !== null && ex !== void 0 ? ex : null);
        if ((ex === null || ex === void 0 ? void 0 : ex.content_hash) === item.content_hash)
            continue;
        out.push(item);
    }
    return out;
}
function ms_of(t) {
    const v = t;
    return v && typeof v.toMillis === "function" ? v.toMillis() : 0;
}
//# sourceMappingURL=recurring_detector.service.js.map