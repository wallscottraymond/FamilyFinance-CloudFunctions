"use strict";
/**
 * Derive Budget View Orchestrator
 *
 * Read-only coordination for the Derive-On-Read Period Architecture (Phase 1):
 * derive a budget's non-monthly VIEW (weekly / bi-weekly) for a bounded visible
 * window, computed from the single materialized monthly home + the splits.
 *
 * No idempotency, no events, no writes — a read. All work is bounded to the
 * requested window (the hard window bound from the design).
 *
 * @module orchestrators/budgets/derive_budget_view
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.derive_budget_view_orchestrator = derive_budget_view_orchestrator;
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const budget_repo_1 = require("../../repositories/budget.repo");
const budget_view_resolver_1 = require("../../resolvers/budgets/budget_view.resolver");
const budget_view_service_1 = require("../../domain/budgets/budget_view.service");
/** Read-only budget: derivation reads a bounded window; keep it generous. */
const BUDGET = {
    max_reads: 60,
    max_writes: 0,
    max_time_ms: 500,
};
/**
 * Derive a budget's view periods for a window. Returns `null` when the budget
 * doesn't exist or isn't owned by the caller (entry maps that to not-found).
 */
async function derive_budget_view_orchestrator(ctx, user_id, input) {
    var _a;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "derive_budget_view");
    const perf = (0, types_1.create_performance_metrics)();
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        // 1. Load the budget + ownership check (shared-group access is a later,
        //    RBAC-owned concern; owner covers the parity gate + single-user case).
        const budget = await budget_repo_1.budget_repo.get_by_id(ctx, input.budget_id);
        perf.reads++;
        if (!budget ||
            (budget.user_id !== user_id && budget.owner_id !== user_id)) {
            return null;
        }
        // 2. Gather derivation inputs (buckets + monthly periods + splits), bounded
        //    to the window.
        const deps = await (0, budget_view_resolver_1.resolve_budget_view_deps)(ctx, user_id, input.budget_id, input.view_cadence, input.window_start_ms, input.window_end_ms, (_a = input.match_mode) !== null && _a !== void 0 ? _a : "stored", budget.is_system_everything_else === true);
        perf.reads += input.match_mode === "on_read" ? 4 : 3;
        // 3. Pure derivation.
        const periods = (0, budget_view_service_1.derive_budget_view_periods)(input.budget_id, deps.buckets, deps.monthly_periods, deps.splits);
        if ((0, types_1.is_budget_exceeded)(perf, BUDGET)) {
            console.warn(`[${ctx.trace_id}] Performance budget exceeded for derive_budget_view`);
        }
        (0, observability_1.log_operation_success)(span, user_id);
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: "orchestrator",
            function: "derive_budget_view",
            status: "success",
            output: {
                view_cadence: input.view_cadence,
                bucket_count: deps.buckets.length,
                split_count: deps.splits.length,
            },
            context: { perf_reads: perf.reads },
        }));
        return {
            budget_id: input.budget_id,
            budget_name: budget.name,
            view_cadence: input.view_cadence,
            periods,
        };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id, error_code: "DERIVE_BUDGET_VIEW_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=derive_budget_view.orchestrator.js.map