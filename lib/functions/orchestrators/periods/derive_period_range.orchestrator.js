"use strict";
/**
 * Derive Period RANGE Orchestrator (read-only)
 *
 * Derives MANY period windows of one cadence in a single call (the Home preload: the last 12
 * periods), plus each window's goals view. Per window the result is IDENTICAL to
 * `derive_period` + `derive_goals_view` for that window — same shaping
 * (`shape_period_derivation_deps`), same pure computation (`compute_period_view`,
 * `build_goals_view`) — but the user's definitions + the transactions for the whole range are read
 * ONCE instead of once per window.
 *
 * Shares `derive_period`'s per-window L2 cache (same keys, version-stamped): windows served from
 * the cache skip computation; only the misses are loaded + derived, and their results are written
 * back so a later single-window `derive_period` hits too.
 *
 * @module orchestrators/periods/derive_period_range
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.derive_period_range_orchestrator = derive_period_range_orchestrator;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const period_derivation_resolver_1 = require("../../resolvers/periods/period_derivation.resolver");
const goal_measurement_resolver_1 = require("../../resolvers/goals/goal_measurement.resolver");
const period_view_service_1 = require("../../domain/periods/period_view.service");
const goals_view_service_1 = require("../../domain/goals/goals_view.service");
const source_period_repo_1 = require("../../repositories/source_period.repo");
const derive_version_repo_1 = require("../../repositories/derive_version.repo");
const derive_period_cache_repo_1 = require("../../repositories/derive_period_cache.repo");
/**
 * Transactions dominate (a cold 12-month range reads every active txn in it, ~4k for a heavy
 * user); cached windows cost 1 read each. Tracked for visibility, not enforced.
 */
const BUDGET = { max_reads: 6000, max_writes: 0, max_time_ms: 8000 };
/** Same TTL backstop as `derive_period` (correctness comes from the data_version match). */
const CACHE_TTL_MS = 10 * 60 * 1000;
async function derive_period_range_orchestrator(ctx, user_id, input) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "derive_period_range");
    const perf = (0, types_1.create_performance_metrics)();
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const range_start_ms = Math.min(...input.windows.map((w) => w.start_ms));
        const range_end_ms = Math.max(...input.windows.map((w) => w.end_ms));
        // 1. Version + every window's cached result + the range's source periods (for goal period
        //    dates, exactly as `derive_goals_view` reads them) — one parallel round-trip.
        const [data_version, cached, range_periods] = await Promise.all([
            (0, derive_version_repo_1.get_derive_version)(user_id),
            input.force
                ? Promise.resolve(input.windows.map(() => null))
                : Promise.all(input.windows.map((w) => (0, derive_period_cache_repo_1.get_cached_derived_period)(user_id, input.view_cadence, w.start_ms, w.end_ms))),
            source_period_repo_1.source_period_repo.get_overlapping(ctx, firestore_1.Timestamp.fromMillis(range_start_ms), firestore_1.Timestamp.fromMillis(range_end_ms)),
        ]);
        perf.reads += 1 + (input.force ? 0 : input.windows.length) + range_periods.length;
        const now_ms = Date.now();
        const results = new Map();
        const misses = [];
        input.windows.forEach((_, i) => {
            const c = cached[i];
            if (c && c.data_version === data_version && now_ms - c.computed_at_ms < CACHE_TTL_MS) {
                results.set(i, { derive: c.result, from_cache: true });
            }
            else {
                misses.push(i);
            }
        });
        // 2. Misses: ONE load for all of them, then the per-window shaping + pure derive.
        if (misses.length > 0) {
            const miss_windows = misses.map((i) => ({
                start_ms: input.windows[i].start_ms,
                end_ms: input.windows[i].end_ms,
            }));
            const raw = await (0, period_derivation_resolver_1.load_period_derivation_raw)(ctx, user_id, input.view_cadence, miss_windows);
            perf.reads += 8 + raw.txns.length;
            for (const i of misses) {
                const w = input.windows[i];
                const deps = (0, period_derivation_resolver_1.shape_period_derivation_deps)(raw, input.view_cadence, w.start_ms, w.end_ms);
                const derive = (0, period_view_service_1.compute_period_view)(deps, input.view_cadence);
                results.set(i, { derive, from_cache: false });
                // Same version-stamped write as `derive_period` (fire-and-forget; never fails the call).
                (0, observability_1.fire_and_forget)(() => (0, derive_period_cache_repo_1.put_cached_derived_period)(user_id, input.view_cadence, w.start_ms, w.end_ms, data_version, derive));
            }
        }
        // 3. Goals per window (goals read once; each period reads its own balance snapshots).
        const period_by_id = new Map(range_periods.map((p) => [p.period_id, p]));
        const goal_periods = input.windows
            .map((w) => period_by_id.get(w.period_id))
            .filter((p) => p !== undefined)
            .map((p) => ({ period_id: p.period_id, start: p.start_date, end: p.end_date }));
        const goal_views = await (0, goal_measurement_resolver_1.resolve_goal_measurements_for_periods)(ctx, user_id, goal_periods);
        const windows = input.windows.map((w, i) => {
            const r = results.get(i);
            const views = goal_views.get(w.period_id);
            return {
                period_id: w.period_id,
                start_ms: w.start_ms,
                end_ms: w.end_ms,
                derive: r.derive,
                goals: views ? (0, goals_view_service_1.build_goals_view)(w.period_id, views) : null,
                from_cache: r.from_cache,
            };
        });
        if ((0, types_1.is_budget_exceeded)(perf, BUDGET)) {
            console.warn(`[${ctx.trace_id}] Performance budget exceeded for derive_period_range`);
        }
        (0, observability_1.log_operation_success)(span, user_id);
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: "orchestrator",
            function: "derive_period_range",
            status: "success",
            output: {
                view_cadence: input.view_cadence,
                windows: input.windows.length,
                cache_hits: input.windows.length - misses.length,
                reads: perf.reads,
            },
        }));
        return { view_cadence: input.view_cadence, windows };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id, error_code: "DERIVE_PERIOD_RANGE_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=derive_period_range.orchestrator.js.map