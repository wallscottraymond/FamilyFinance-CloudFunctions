"use strict";
/**
 * Expected Occurrences Domain Service
 *
 * THE expected occurrences (due date + expected amount) of a bill / income over a span — exactly
 * what the period page shows for an outstanding occurrence. Shared by the period page
 * (`compute_period_view`) and "Mark as paid / received" (which settles an occurrence at the
 * amount the page expects), so both read one rule:
 *
 *   per-occurrence override (income) > per-slot history estimate (income, no definition
 *   override) > definition override (`expectedAmountOverride`, already in `schedule`) > average.
 *
 * PURE: no IO.
 *
 * @module domain/recurring/expected_occurrences
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.uses_income_parts = uses_income_parts;
exports.income_check_dates = income_check_dates;
exports.make_income_expected_parts = make_income_expected_parts;
exports.build_expected_occurrences = build_expected_occurrences;
const outflow_period_service_1 = require("../outflows/outflow_period.service");
const income_slot_amounts_1 = require("./income_slot_amounts");
const manual_settlement_service_1 = require("./manual_settlement.service");
const income_parts_service_1 = require("./income_parts.service");
/** True when the income's amounts come from its parts. */
function uses_income_parts(r) {
    var _a, _b;
    return r.kind === "inflow" && ((_b = (_a = r.income_parts) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) > 0;
}
/** Every check date of the income's UTC months touching the span (so "last check of the month"
 *  is right even when the span ends mid-month). */
function income_check_dates(r, span_start_ms, span_end_ms) {
    const s = new Date(span_start_ms);
    const e = new Date(span_end_ms);
    const from = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1);
    const to = Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 0, 23, 59, 59, 999);
    return (0, outflow_period_service_1.generate_expected_occurrences_in_window)(r.schedule, from, to).map((g) => g.due_date_ms);
}
/**
 * The calculator for an income's EXPECTED parts of an outstanding check (one rule, shared by the
 * amount in `build_expected_occurrences` and the breakdown the period page returns).
 */
function make_income_expected_parts(r, span_start_ms, span_end_ms, extra_dates_ms = []) {
    var _a, _b;
    const is_last = (0, income_parts_service_1.make_is_last_of_month)([...income_check_dates(r, span_start_ms, span_end_ms), ...extra_dates_ms]);
    return (0, income_parts_service_1.make_expected_parts_calculator)({
        parts: (_a = r.income_parts) !== null && _a !== void 0 ? _a : [],
        settings: r.forecast_settings,
        deposits: (_b = r.payment_history) !== null && _b !== void 0 ? _b : [],
        occurrence_parts: r.occurrence_parts,
        check_dates: (from, to) => (0, outflow_period_service_1.generate_expected_occurrences_in_window)(r.schedule, from, to).map((g) => g.due_date_ms),
    }, is_last);
}
function build_expected_occurrences(r, span_start_ms, span_end_ms) {
    var _a, _b;
    // "As it comes" income plans nothing: every deposit labelled with it reconciles as an extra
    // (received) occurrence, so it shows exactly what arrived (D24).
    if (r.kind === "inflow" && r.as_it_comes)
        return [];
    // Both bills AND income generate EXPECTED occurrences from the schedule (freq + anchor)
    // across the span — so a semi-monthly item yields 2/month and future months still show
    // upcoming occurrences.
    let expected = (0, outflow_period_service_1.generate_expected_occurrences_in_window)(r.schedule, span_start_ms, span_end_ms).map((g) => ({
        occurrence_id: `${r.id}_${g.due_date_ms}`,
        recurring_id: r.id,
        due_date_ms: g.due_date_ms,
        amount_due: g.amount_due,
    }));
    // INCOME per-slot amounts: give each occurrence its OWN slot's recent-average amount
    // (mid-month vs end-of-month) from history, instead of the single blended stream average.
    // Received occurrences still use the ACTUAL deposit (in reconcile); this sets the amount
    // shown for OUTSTANDING occurrences.
    // SKIP when the user set an explicit expected-amount override ("this + future") — an
    // explicit override MUST win over the auto slot-estimate, otherwise editing the expected
    // does nothing for multi-occurrence income (its amount_due already carries the override).
    // Parts (when the income has them) replace the amount here; legacy per-check overrides still win below.
    if (uses_income_parts(r)) {
        const parts_for = make_income_expected_parts(r, span_start_ms, span_end_ms);
        expected = expected.map((e) => (Object.assign(Object.assign({}, e), { amount_due: (0, income_parts_service_1.sum_parts)(parts_for(e.due_date_ms)) })));
    }
    else if (r.kind === "inflow" && !r.has_amount_override && ((_b = (_a = r.payment_history) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) > 0) {
        const occ_days = expected.map((e) => new Date(e.due_date_ms).getUTCDate());
        const slot_amounts = (0, income_slot_amounts_1.estimate_slot_amounts)(occ_days, r.payment_history);
        if (slot_amounts.size > 0) {
            expected = expected.map((e) => {
                const day = new Date(e.due_date_ms).getUTCDate();
                const amt = slot_amounts.get(day);
                return amt != null ? Object.assign(Object.assign({}, e), { amount_due: amt }) : e;
            });
        }
    }
    // Per-occurrence MANUAL override wins over everything (slot estimate + definition
    // override): if the user set an amount for a specific occurrence — keyed by its UTC
    // due-date `YYYY-MM-DD` — use it. Outstanding occurrences only; received ones show the
    // actual deposit via reconcile. Lets the user edit one check at a time (e.g. just the
    // Sep 30 commission) without moving the others.
    const occ_overrides = r.occurrence_amount_overrides;
    if (r.kind === "inflow" && occ_overrides && Object.keys(occ_overrides).length > 0) {
        expected = expected.map((e) => {
            const amt = occ_overrides[(0, manual_settlement_service_1.occurrence_date_key)(e.due_date_ms)];
            return amt != null ? Object.assign(Object.assign({}, e), { amount_due: amt }) : e;
        });
    }
    return expected;
}
//# sourceMappingURL=expected_occurrences.service.js.map