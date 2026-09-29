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
const period_view_service_1 = require("../../domain/periods/period_view.service");
const derive_version_repo_1 = require("../../repositories/derive_version.repo");
const derive_period_cache_repo_1 = require("../../repositories/derive_period_cache.repo");
const BUDGET = { max_reads: 200, max_writes: 0, max_time_ms: 1500 };
/**
 * TTL SAFETY BACKSTOP for the L2 derive cache ([[Firestore-Read-Cost-Reduction]]).
 * Correctness comes from the per-user `data_version` match — this only bounds staleness
 * to minutes (rather than forever) in the event some write path forgot to bump the version.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
async function derive_period_orchestrator(ctx, user_id, input) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "derive_period");
    const perf = (0, types_1.create_performance_metrics)();
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        // L2 CACHE ([[Firestore-Read-Cost-Reduction]]): read the user's current derive-input
        // version + any cached result for this exact (cadence, window) — 2 reads. Serve the
        // cache iff the versions match AND it's within the TTL backstop, skipping the
        // ~9-collection fan-out + in-memory derivation below.
        //
        // `force` (set by the FE right after a config mutation) skips the cache SERVE entirely so the
        // edit reflects immediately without waiting out the async version-bump race / TTL backstop.
        // We still read the current version (to stamp the overwrite) but skip the cached-doc read.
        let data_version;
        if (input.force) {
            data_version = await (0, derive_version_repo_1.get_derive_version)(user_id);
            perf.reads += 1;
        }
        else {
            const [version, cached] = await Promise.all([
                (0, derive_version_repo_1.get_derive_version)(user_id),
                (0, derive_period_cache_repo_1.get_cached_derived_period)(user_id, input.view_cadence, input.window_start_ms, input.window_end_ms),
            ]);
            perf.reads += 2;
            data_version = version;
            if (cached &&
                cached.data_version === data_version &&
                Date.now() - cached.computed_at_ms < CACHE_TTL_MS) {
                (0, observability_1.log_operation_success)(span, user_id);
                return cached.result;
            }
        }
        const deps = await (0, period_derivation_resolver_1.resolve_period_derivation_deps)(ctx, user_id, input.view_cadence, input.window_start_ms, input.window_end_ms);
        perf.reads += 7;
        const { budgets, bills, income } = (0, period_view_service_1.compute_period_view)(deps, input.view_cadence);
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
        const result = {
            view_cadence: input.view_cadence,
            budgets,
            bills,
            income,
        };
        // Store the freshly-computed result stamped with the version it was computed at
        // (fire-and-forget — a cache-write failure must never fail the derive). Uses the
        // version read at the TOP of this call: if a bump landed mid-compute, the stamp is
        // now stale, so the next read misses and recomputes — never serving stale data.
        (0, observability_1.fire_and_forget)(() => (0, derive_period_cache_repo_1.put_cached_derived_period)(user_id, input.view_cadence, input.window_start_ms, input.window_end_ms, data_version, result));
        return result;
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id, error_code: "DERIVE_PERIOD_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=derive_period.orchestrator.js.map