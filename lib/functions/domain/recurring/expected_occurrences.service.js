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
exports.build_expected_occurrences = build_expected_occurrences;
const outflow_period_service_1 = require("../outflows/outflow_period.service");
const income_slot_amounts_1 = require("./income_slot_amounts");
const manual_settlement_service_1 = require("./manual_settlement.service");
function build_expected_occurrences(r, span_start_ms, span_end_ms) {
    var _a, _b;
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
    if (r.kind === "inflow" && !r.has_amount_override && ((_b = (_a = r.payment_history) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) > 0) {
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