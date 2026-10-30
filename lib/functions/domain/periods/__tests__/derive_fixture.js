"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.round2 = exports.is_released = exports.schedule_of = exports.DAY = void 0;
exports.buckets = buckets;
exports.derive = derive;
exports.by_bucket = by_bucket;
exports.payment_counts = payment_counts;
/**
 * Pure fixture for `compute_period_view` tests (review round 3): one bill + Everything Else, the
 * view buckets of a cadence, and each payment routed the way the assignment engine routes it — a
 * payment in a removed / paused (UTC) month is released (no bill link → Everything Else spend),
 * except (D31) a LATE payment of the bill's last occurrence before the cut-off; every other payment
 * is linked to the bill (excluded from budgets, settles an occurrence) — `is_payment_released`.
 * Not a test file (no `.test.`): helpers only.
 */
const firestore_1 = require("firebase-admin/firestore");
const period_view_service_1 = require("../period_view.service");
const recurring_suppression_service_1 = require("../../recurring/recurring_suppression.service");
const late_payment_service_1 = require("../../recurring/late_payment.service");
exports.DAY = 86400000;
/** Monthly / Sun–Sat weekly / 1–15 + 16–end buckets covering [from, to). */
function buckets(cadence, from_ms, to_ms) {
    const out = [];
    const d0 = new Date(from_ms);
    if (cadence === "monthly") {
        for (let y = d0.getUTCFullYear(), m = d0.getUTCMonth(); Date.UTC(y, m, 1) < to_ms; m++) {
            out.push({ period_id: `M_${y}_${m}`, start_ms: Date.UTC(y, m, 1), end_ms: Date.UTC(y, m + 1, 1) - 1 });
        }
    }
    else if (cadence === "bi_monthly") {
        for (let y = d0.getUTCFullYear(), m = d0.getUTCMonth(); Date.UTC(y, m, 1) < to_ms; m++) {
            out.push({ period_id: `BM_${y}_${m}_A`, start_ms: Date.UTC(y, m, 1), end_ms: Date.UTC(y, m, 16) - 1 });
            out.push({ period_id: `BM_${y}_${m}_B`, start_ms: Date.UTC(y, m, 16), end_ms: Date.UTC(y, m + 1, 1) - 1 });
        }
    }
    else {
        const start = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate()) - d0.getUTCDay() * exports.DAY;
        for (let s = start; s < to_ms; s += 7 * exports.DAY)
            out.push({ period_id: `W_${s}`, start_ms: s, end_ms: s + 7 * exports.DAY - 1 });
    }
    return out;
}
/** The bill's schedule (as the period page builds it). */
const schedule_of = (bill) => ({
    frequency: bill.frequency, average_amount: bill.amount, first_date: firestore_1.Timestamp.fromMillis(bill.first_ms),
    last_date: firestore_1.Timestamp.fromMillis(bill.anchor_ms), predicted_next_date: firestore_1.Timestamp.fromMillis(bill.anchor_ms),
});
exports.schedule_of = schedule_of;
/** The engine's routing: is this payment released from the bill (→ Everything Else)? Judged
 *  (D37) with every payment of the bill, as the engine / stored reconcile / the derive see them. */
const is_released = (bill, p) => (0, late_payment_service_1.is_payment_released)(bill.removal_intervals, p, { schedule: (0, exports.schedule_of)(bill), payments: bill.payments });
exports.is_released = is_released;
/**
 * `span_limited` models the period page's RESOLVER loading (D37): the matcher gets only the
 * payments inside the view's span, plus — the D31 late block — a payment up to 7 days past the
 * span made in a month suppressed for the bill that the release rule keeps; only the span's
 * payments are counted as spend. Without it every payment of the bill is passed (a whole-year view).
 */
function derive(bills, cadence, window, opts = {}) {
    const b = buckets(cadence, window.start, window.end + 1);
    const span_start = b[0].start_ms;
    const span_end = b[b.length - 1].end_ms;
    const in_span = (ms) => !opts.span_limited || (ms >= span_start && ms <= span_end);
    const late_reach = (bill, ms) => !!opts.span_limited && ms > span_end && ms <= span_end + 7 * exports.DAY && (0, recurring_suppression_service_1.is_payment_suppressed)(bill.removal_intervals, ms);
    const deps = {
        view_buckets: b.map((x) => (Object.assign(Object.assign({}, x), { period_type: cadence }))),
        placement_buckets: b,
        budgets: [{ id: "ee", name: "Everything Else", is_ee: true, monthly_periods: [], active_start_ms: 0, active_end_ms: null }],
        real_budgets: [],
        monthly_ee_id: "ee",
        any_ee_id: "ee",
        splits_for_match: bills.flatMap((bill) => bill.payments.filter((p) => in_span(p.date_ms)).map((p) => {
            const released = (0, exports.is_released)(bill, p);
            return {
                amount: p.amount, txn_date_ms: p.date_ms, is_pending: false, is_transfer: false, is_income: false,
                spend_status: "counted", outflow_id: released ? null : bill.id, inflow_id: null,
                first_category_id: null, semantic_code: "RENT_AND_UTILITIES_RENT", manual_pin_budget_id: null,
            };
        })),
        recurring: bills.map((bill) => ({
            id: bill.id,
            name: bill.id,
            kind: "outflow",
            schedule: (0, exports.schedule_of)(bill),
            payments: bill.payments
                .filter((p) => (in_span(p.date_ms) || late_reach(bill, p.date_ms)) && !(0, exports.is_released)(bill, p))
                .map((p) => ({ transaction_id: p.id, split_id: null, date_ms: p.date_ms, amount: p.amount })),
            removal_intervals: bill.removal_intervals,
        })),
        goals: [],
        other_income_credits: [],
        span_start_ms: b[0].start_ms,
        span_end_ms: b[b.length - 1].end_ms,
    };
    return (0, period_view_service_1.compute_period_view)(deps, cadence);
}
/** Per bucket: the bill's visible group (or null) + Everything Else spend. */
function by_bucket(r, bill_id) {
    var _a, _b, _c;
    const out = new Map();
    const ee = r.budgets.find((x) => x.is_everything_else);
    for (const p of ee.periods)
        out.set(p.period_id, { group: null, ee: p.spent });
    for (const g of (_b = (_a = r.bills.find((x) => x.recurring_id === bill_id)) === null || _a === void 0 ? void 0 : _a.groups) !== null && _b !== void 0 ? _b : []) {
        out.set(g.period_id, Object.assign(Object.assign({}, ((_c = out.get(g.period_id)) !== null && _c !== void 0 ? _c : { ee: 0 })), { group: g }));
    }
    return out;
}
/** Every payment's count across the view: as a paid occurrence (by transaction id) + as spend. */
function payment_counts(r, bills) {
    var _a;
    const counts = new Map();
    for (const bill of bills)
        for (const p of bill.payments)
            counts.set(p.id, 0);
    for (const bill of r.bills)
        for (const g of bill.groups)
            for (const o of g.occurrences) {
                if (o.paid && o.transaction_id)
                    counts.set(o.transaction_id, ((_a = counts.get(o.transaction_id)) !== null && _a !== void 0 ? _a : 0) + 1);
            }
    return counts;
}
const round2 = (n) => Math.round(n * 100) / 100;
exports.round2 = round2;
//# sourceMappingURL=derive_fixture.js.map