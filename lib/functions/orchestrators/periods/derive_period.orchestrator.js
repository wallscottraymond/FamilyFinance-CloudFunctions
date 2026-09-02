"use strict";
/**
 * Derive Period Orchestrator (batched)
 *
 * Read-only coordination for a whole period view in ONE call: budgets (derived,
 * on-read matched), bills, and income for the requested cadence + window. Loads
 * the shared data once (resolver) then loops the pure services in memory —
 * collapsing the client's ~N callable round-trips into one and removing the
 * per-item re-reads.
 *
 * @module orchestrators/periods/derive_period
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.derive_period_orchestrator = derive_period_orchestrator;
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const period_derivation_resolver_1 = require("../../resolvers/periods/period_derivation.resolver");
const budget_view_service_1 = require("../../domain/budgets/budget_view.service");
const budget_spend_match_service_1 = require("../../domain/budgets/budget_spend_match.service");
const outflow_period_service_1 = require("../../domain/outflows/outflow_period.service");
const income_slot_amounts_1 = require("../../domain/recurring/income_slot_amounts");
const reconcile_occurrences_service_1 = require("../../domain/recurring/reconcile_occurrences.service");
const occurrence_placement_service_1 = require("../../domain/recurring/occurrence_placement.service");
const recurring_suppression_service_1 = require("../../domain/recurring/recurring_suppression.service");
const BUDGET = { max_reads: 200, max_writes: 0, max_time_ms: 1500 };
/** Synthetic income id for the "Other Income" bucket (unmatched real INCOME_* credits). */
const OTHER_INCOME_ID = "__other_income__";
async function derive_period_orchestrator(ctx, user_id, input) {
    var _a, _b;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "derive_period");
    const perf = (0, types_1.create_performance_metrics)();
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const deps = await (0, period_derivation_resolver_1.resolve_period_derivation_deps)(ctx, user_id, input.view_cadence, input.window_start_ms, input.window_end_ms);
        perf.reads += 6;
        // Budgets — on-read match + derive (all from the shared splits, in memory).
        const budgets = deps.budgets.map((b) => {
            var _a;
            const ee_id = b.is_ee ? b.id : (_a = deps.monthly_ee_id) !== null && _a !== void 0 ? _a : deps.any_ee_id;
            const owned = (0, budget_spend_match_service_1.owned_splits_for_budget)(b.id, deps.real_budgets, ee_id, deps.splits_for_match);
            const periods = (0, budget_view_service_1.derive_budget_view_periods)(b.id, deps.view_buckets, b.monthly_periods, owned);
            return { budget_id: b.id, name: b.name, is_everything_else: b.is_ee, periods };
        });
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
            if (r.kind === "inflow" && ((_b = (_a = r.payment_history) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) > 0) {
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
                recurring_id: OTHER_INCOME_ID,
                due_date_ms: c.date_ms,
                amount_due: c.amount,
                amount_paid: c.amount,
                is_paid: true,
            }));
            const other_groups = (0, occurrence_placement_service_1.place_occurrences)(other_occurrences, deps.placement_buckets);
            if (other_groups.some((g) => g.is_due_period)) {
                income.push({ recurring_id: OTHER_INCOME_ID, name: "Other Income", groups: other_groups });
            }
        }
        if ((0, types_1.is_budget_exceeded)(perf, BUDGET)) {
            console.warn(`[${ctx.trace_id}] Performance budget exceeded for derive_period`);
        }
        (0, observability_1.log_operation_success)(span, user_id);
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: "orchestrator",
            function: "derive_period",
            status: "success",
            output: {
                view_cadence: input.view_cadence,
                budgets: budgets.length,
                bills: bills.length,
                income: income.length,
                splits: deps.splits_for_match.length,
            },
        }));
        return { view_cadence: input.view_cadence, budgets, bills, income };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id, error_code: "DERIVE_PERIOD_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=derive_period.orchestrator.js.map