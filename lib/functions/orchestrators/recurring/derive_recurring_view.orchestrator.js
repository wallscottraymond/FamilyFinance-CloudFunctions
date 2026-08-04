"use strict";
/**
 * Derive Recurring View Orchestrator
 *
 * Read-only coordination for the Derive-On-Read Period Architecture (Phase 3):
 * derive a bill/income (recurring outflow) view for a bounded window by running
 * the pure pipeline — generate expected occurrences FRESH from the schedule →
 * reconcile against actual payments → place into the viewed cadence's buckets.
 * Nothing is stored, so nothing can go stale.
 *
 * @module orchestrators/recurring/derive_recurring_view
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.derive_recurring_view_orchestrator = derive_recurring_view_orchestrator;
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const recurring_view_resolver_1 = require("../../resolvers/recurring/recurring_view.resolver");
const outflow_period_service_1 = require("../../domain/outflows/outflow_period.service");
const reconcile_occurrences_service_1 = require("../../domain/recurring/reconcile_occurrences.service");
const occurrence_placement_service_1 = require("../../domain/recurring/occurrence_placement.service");
const BUDGET = {
    max_reads: 60,
    max_writes: 0,
    max_time_ms: 500,
};
/**
 * Derive a recurring item's view for a window. Returns `null` when the outflow
 * doesn't exist or isn't owned by the caller (entry maps that to not-found).
 */
async function derive_recurring_view_orchestrator(ctx, user_id, input) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "derive_recurring_view");
    const perf = (0, types_1.create_performance_metrics)();
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        // 1. Gather deps (schedule + buckets + payments), bounded to the window.
        const deps = await (0, recurring_view_resolver_1.resolve_recurring_view_deps)(ctx, user_id, input.kind, input.recurring_id, input.view_cadence, input.window_start_ms, input.window_end_ms);
        perf.reads += 3;
        if (!deps) {
            return null;
        }
        // 2. Pure pipeline: generate FRESH → reconcile → place.
        const expected = (0, outflow_period_service_1.generate_expected_occurrences_in_window)(deps.schedule, deps.span_start_ms, deps.span_end_ms).map((g) => ({
            occurrence_id: `${input.recurring_id}_${g.due_date_ms}`,
            recurring_id: input.recurring_id,
            due_date_ms: g.due_date_ms,
            amount_due: g.amount_due,
        }));
        const reconciled = (0, reconcile_occurrences_service_1.reconcile_occurrences)(expected, deps.payments);
        const groups = (0, occurrence_placement_service_1.place_occurrences)(reconciled, deps.buckets);
        if ((0, types_1.is_budget_exceeded)(perf, BUDGET)) {
            console.warn(`[${ctx.trace_id}] Performance budget exceeded for derive_recurring_view`);
        }
        (0, observability_1.log_operation_success)(span, user_id);
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: "orchestrator",
            function: "derive_recurring_view",
            status: "success",
            output: {
                view_cadence: input.view_cadence,
                bucket_count: deps.buckets.length,
                expected_count: expected.length,
                payment_count: deps.payments.length,
            },
        }));
        return {
            kind: input.kind,
            recurring_id: input.recurring_id,
            name: deps.name,
            view_cadence: input.view_cadence,
            groups,
        };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id, error_code: "DERIVE_RECURRING_VIEW_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=derive_recurring_view.orchestrator.js.map