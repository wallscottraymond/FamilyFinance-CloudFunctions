"use strict";
/**
 * Period View Service (pure)
 *
 * Derives a WHOLE period view — budgets (on-read matched), bills, income (generate → reconcile →
 * place), the synthetic "Other Income" bucket, and the Everything-Else leftover — from one
 * window's resolved inputs. Pure + deterministic: no IO, no clock. Shared by `derive_period`
 * (one window) and `derive_period_range` (many windows from one load), so every window's result
 * is computed by exactly the same code.
 *
 * @module domain/periods/period_view.service
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OTHER_INCOME_ID = void 0;
exports.compute_period_view = compute_period_view;
const budget_view_service_1 = require("../budgets/budget_view.service");
const budget_spend_match_service_1 = require("../budgets/budget_spend_match.service");
const everything_else_leftover_service_1 = require("../budgets/everything_else_leftover.service");
const outflow_period_service_1 = require("../outflows/outflow_period.service");
const income_slot_amounts_1 = require("../recurring/income_slot_amounts");
const reconcile_occurrences_service_1 = require("../recurring/reconcile_occurrences.service");
const occurrence_placement_service_1 = require("../recurring/occurrence_placement.service");
const recurring_suppression_service_1 = require("../recurring/recurring_suppression.service");
/** Synthetic income id for the "Other Income" bucket (unmatched real INCOME_* credits). */
exports.OTHER_INCOME_ID = "__other_income__";
function compute_period_view(deps, view_cadence) {
    var _a, _b, _c, _d;
    // Budgets — on-read match + derive (all from the shared splits, in memory).
    const budgets = deps.budgets
        .map((b) => {
        var _a;
        const ee_id = b.is_ee ? b.id : (_a = deps.monthly_ee_id) !== null && _a !== void 0 ? _a : deps.any_ee_id;
        const owned = (0, budget_spend_match_service_1.owned_splits_for_budget)(b.id, deps.real_budgets, ee_id, deps.splits_for_match);
        const periods = (0, budget_view_service_1.derive_budget_view_periods)(b.id, deps.view_buckets, b.monthly_periods, owned, b.active_start_ms, b.active_end_ms);
        return { budget_id: b.id, name: b.name, is_everything_else: b.is_ee, periods };
    })
        // A budget with NO periods in this view is entirely outside its active range (e.g. a newly
        // created budget viewed in a past period) — omit it so no empty $0 card is surfaced. EE is
        // active from epoch, so it always has periods and is never dropped.
        .filter((b) => b.periods.length > 0);
    // Bills + income — generate → reconcile → place (in memory).
    // Period end (ms) per bucket → drop occurrence-groups in a suppressed period
    // (user remove/pause), snapping to whole periods per the viewing cadence.
    const period_end_by_id = new Map(deps.placement_buckets.map((b) => [b.period_id, b.end_ms]));
    const bills = [];
    const income = [];
    for (const r of deps.recurring) {
        // Both bills AND income generate EXPECTED occurrences from the schedule (freq +
        // anchor) across the window — so a semi-monthly item yields 2/month and future
        // months still show upcoming occurrences (income no longer projects just one).
        let expected = (0, outflow_period_service_1.generate_expected_occurrences_in_window)(r.schedule, deps.span_start_ms, deps.span_end_ms).map((g) => ({
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
        // actual deposit via reconcile below. Lets the user edit one check at a time (e.g. just
        // the Sep 30 commission) without moving the others.
        const occ_overrides = r.occurrence_amount_overrides;
        if (r.kind === "inflow" && occ_overrides && Object.keys(occ_overrides).length > 0) {
            expected = expected.map((e) => {
                const key = new Date(e.due_date_ms).toISOString().slice(0, 10);
                const amt = occ_overrides[key];
                return amt != null ? Object.assign(Object.assign({}, e), { amount_due: amt }) : e;
            });
        }
        // Income reconciles those expected occurrences against ACTUAL Plaid deposits
        // (authoritative receipts, with extras surfaced); bills reconcile against linked
        // payments. Both then place into the view buckets identically.
        const reconciled = r.kind === "inflow"
            ? (0, reconcile_occurrences_service_1.reconcile_income_occurrences)(r.id, r.payments, expected, deps.span_start_ms, deps.span_end_ms)
            : (0, reconcile_occurrences_service_1.reconcile_occurrences)(expected, r.payments);
        const groups = (0, occurrence_placement_service_1.place_occurrences)(reconciled, deps.placement_buckets);
        // Suppress groups whose period is removed/paused for this item (per-period snap).
        const visible_groups = groups.filter((g) => {
            const end_ms = period_end_by_id.get(g.period_id);
            return end_ms === undefined || !(0, recurring_suppression_service_1.is_suppressed_in_period)(r.removal_intervals, end_ms);
        });
        (r.kind === "outflow" ? bills : income).push({
            recurring_id: r.id,
            name: r.name,
            groups: visible_groups,
        });
    }
    // "Other income received": real INCOME_* credits in the window not tied to any recurring
    // inflow (off-cycle paychecks, bonuses, contractor/gig). Surface them as a synthetic
    // "Other Income" bucket — each a RECEIVED occurrence with its actual amount — so real
    // income is never hidden just because Plaid didn't group it into a recurring stream.
    if (deps.other_income_credits.length > 0) {
        const other_occurrences = deps.other_income_credits.map((c, i) => ({
            occurrence_id: `other_income_${c.date_ms}_${i}`,
            recurring_id: exports.OTHER_INCOME_ID,
            due_date_ms: c.date_ms,
            amount_due: c.amount,
            amount_paid: c.amount,
            is_paid: true,
        }));
        const other_groups = (0, occurrence_placement_service_1.place_occurrences)(other_occurrences, deps.placement_buckets);
        if (other_groups.some((g) => g.is_due_period)) {
            income.push({ recurring_id: exports.OTHER_INCOME_ID, name: "Other Income", groups: other_groups });
        }
    }
    // Everything-Else LEFTOVER: EE's limit = expected income − bills due − goal
    // set-aside − Σ other budgets' allocated, per view bucket (zero-based remainder).
    // All inputs are already computed per bucket above; override the canonical EE.
    const canonical_ee_id = (_c = deps.monthly_ee_id) !== null && _c !== void 0 ? _c : deps.any_ee_id;
    const ee_budget = budgets.find((b) => b.is_everything_else && b.budget_id === canonical_ee_id);
    if (ee_budget) {
        const sum_due_by_period = (results, skip_id) => {
            var _a;
            const m = new Map();
            for (const r of results) {
                if (skip_id && r.recurring_id === skip_id)
                    continue;
                for (const g of r.groups) {
                    m.set(g.period_id, ((_a = m.get(g.period_id)) !== null && _a !== void 0 ? _a : 0) + g.total_due);
                }
            }
            return m;
        };
        // Expected income = recurring streams only (exclude surprise "Other Income"
        // so the leftover stays stable — locked "expected, not received" decision).
        const income_by_period = sum_due_by_period(income, exports.OTHER_INCOME_ID);
        const bills_by_period = sum_due_by_period(bills);
        const budgets_alloc_by_period = new Map();
        for (const b of budgets) {
            if (b.is_everything_else)
                continue;
            for (const p of b.periods) {
                budgets_alloc_by_period.set(p.period_id, ((_d = budgets_alloc_by_period.get(p.period_id)) !== null && _d !== void 0 ? _d : 0) + p.allocated_amount);
            }
        }
        const bucket_inputs = deps.view_buckets.map((vb) => {
            var _a, _b, _c;
            return ({
                period_id: vb.period_id,
                start_ms: vb.start_ms,
                end_ms: vb.end_ms,
                expected_income: (_a = income_by_period.get(vb.period_id)) !== null && _a !== void 0 ? _a : 0,
                bills_due: (_b = bills_by_period.get(vb.period_id)) !== null && _b !== void 0 ? _b : 0,
                other_budgets_allocated: (_c = budgets_alloc_by_period.get(vb.period_id)) !== null && _c !== void 0 ? _c : 0,
            });
        });
        const leftovers = (0, everything_else_leftover_service_1.compute_ee_leftovers)(bucket_inputs, deps.goals);
        ee_budget.periods = ee_budget.periods.map((p) => {
            const lo = leftovers.get(p.period_id);
            if (!lo)
                return p;
            return Object.assign(Object.assign({}, p), { allocated_amount: lo.leftover, effective_amount: lo.leftover, remaining: Math.round((lo.leftover - p.spent + Number.EPSILON) * 100) / 100, no_income: !lo.has_income });
        });
    }
    return { view_cadence, budgets, bills, income };
}
//# sourceMappingURL=period_view.service.js.map