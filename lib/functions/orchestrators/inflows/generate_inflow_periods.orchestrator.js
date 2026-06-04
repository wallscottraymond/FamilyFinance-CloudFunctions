"use strict";
/**
 * Generate Inflow Periods Orchestrator
 *
 * Coordinates the generation of inflow_period documents when a new inflow is created.
 * Follows the 5-layer architecture: Entry → Orchestrator → Resolver → Domain → Repository.
 *
 * @module orchestrators/inflows/generate_inflow_periods
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GENERATE_INFLOW_PERIODS_BUDGET = void 0;
exports.generate_inflow_periods_orchestrator = generate_inflow_periods_orchestrator;
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const inflows_1 = require("../../resolvers/inflows");
const inflows_2 = require("../../domain/inflows");
const inflow_period_repo_1 = require("../../repositories/inflow_period.repo");
const summaries_1 = require("../summaries");
const firestore_1 = require("firebase-admin/firestore");
/**
 * Performance budget for inflow period generation.
 * Generous limits since this is triggered by inflow creation.
 */
exports.GENERATE_INFLOW_PERIODS_BUDGET = {
    max_reads: 50,
    max_writes: 200, // Up to ~150 periods (3 types × 50 periods)
    max_time_ms: 10000, // 10 seconds
};
/**
 * Generate inflow periods for a newly created inflow.
 *
 * This orchestrator:
 * 1. Resolves dependencies (inflow data + source periods)
 * 2. Computes inflow periods using domain service (PURE)
 * 3. Validates periods before persistence
 * 4. Saves periods to Firestore
 *
 * @param ctx - Orchestrator context with trace info and input
 * @returns Result with periods created count
 */
async function generate_inflow_periods_orchestrator(ctx) {
    var _a, _b;
    const start_time = Date.now();
    const perf = (0, types_1.create_performance_metrics)();
    const errors = [];
    // Create span for this orchestrator
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "generate_inflow_periods");
    (0, observability_1.log_operation_start)(span, ctx.input.user_id);
    try {
        // 1. RESOLVE DEPENDENCIES
        const resolve_span = (0, observability_1.create_span)((0, observability_1.create_child_span)(ctx), "resolver", "resolve_inflow_period_dependencies_from_doc");
        let deps;
        try {
            deps = await (0, inflows_1.resolve_inflow_period_dependencies_from_doc)(resolve_span, ctx.input.inflow_id, ctx.input.inflow_data);
            perf.reads += 1; // source_periods query
        }
        catch (error) {
            const err_msg = error instanceof Error ? error.message : String(error);
            errors.push(`Dependency resolution failed: ${err_msg}`);
            (0, observability_1.log_operation_error)(resolve_span, new Error(err_msg));
            return {
                success: false,
                periods_created: 0,
                errors,
                trace_id: ctx.trace_id,
            };
        }
        // Guard: No source periods found
        if (deps.source_periods.length === 0) {
            console.warn(`[${ctx.trace_id}] generate_inflow_periods: No source periods found, skipping`);
            (0, observability_1.log_operation_success)(span, ctx.input.user_id);
            return {
                success: true,
                periods_created: 0,
                trace_id: ctx.trace_id,
            };
        }
        console.log(`[${ctx.trace_id}] generate_inflow_periods: ${deps.source_periods.length} source periods`);
        // 2. COMPUTE INFLOW PERIODS (Domain Service - PURE)
        const now = firestore_1.Timestamp.now();
        const compute_result = (0, inflows_2.compute_inflow_periods)(deps.inflow, deps.source_periods, now);
        if ((0, types_1.has_errors)(compute_result)) {
            errors.push(...((_a = compute_result.validation_errors) !== null && _a !== void 0 ? _a : []));
            (0, observability_1.log_operation_error)(span, new Error(errors.join("; ")));
            return {
                success: false,
                periods_created: 0,
                errors,
                trace_id: ctx.trace_id,
            };
        }
        const periods = (0, types_1.get_entities)(compute_result);
        console.log(`[${ctx.trace_id}] generate_inflow_periods: computed ${periods.length} periods`);
        // 3. VALIDATE PERIODS (Domain Service - PURE)
        const validation_result = (0, inflows_2.validate_inflow_periods)(periods);
        if ((0, types_1.has_errors)(validation_result)) {
            errors.push(...((_b = validation_result.validation_errors) !== null && _b !== void 0 ? _b : []));
            (0, observability_1.log_operation_error)(span, new Error(errors.join("; ")));
            return {
                success: false,
                periods_created: 0,
                errors,
                trace_id: ctx.trace_id,
            };
        }
        // 4. PERSIST PERIODS (Repository)
        const persist_span = (0, observability_1.create_span)((0, observability_1.create_child_span)(ctx), "repository", "inflow_period_repo.save_batch");
        const write_result = await inflow_period_repo_1.inflow_period_repo.save_batch(persist_span, periods, ctx.input.user_id);
        perf.writes += write_result.count;
        // 5. UPDATE USER PERIOD SUMMARIES
        // Uses the 5-layer architecture orchestrator for proper summary updates
        // This is called AFTER all periods are saved to prevent race conditions
        if (write_result.count > 0) {
            const period_ids = periods.map((p) => p.id);
            console.log(`[${ctx.trace_id}] generate_inflow_periods: enqueue ${period_ids.length} summaries`);
            try {
                const summaries_updated = await (0, summaries_1.enqueue_user_summary_updates_from_inflow_periods)(ctx, ctx.input.user_id, period_ids);
                console.log(`[${ctx.trace_id}] generate_inflow_periods: updated ${summaries_updated} summaries`);
                perf.writes += summaries_updated;
            }
            catch (summary_error) {
                // Non-fatal: log but don't fail the orchestrator
                console.error(`[${ctx.trace_id}] generate_inflow_periods: summary update failed (non-fatal):`, summary_error);
            }
        }
        // 6. CHECK PERFORMANCE BUDGET
        perf.time_ms = Date.now() - start_time;
        if ((0, types_1.is_budget_exceeded)(perf, exports.GENERATE_INFLOW_PERIODS_BUDGET)) {
            console.warn(`[${ctx.trace_id}] generate_inflow_periods: Performance budget exceeded`, { perf, budget: exports.GENERATE_INFLOW_PERIODS_BUDGET });
        }
        // 7. LOG SUCCESS
        (0, observability_1.log_operation_success)(span, ctx.input.user_id);
        console.log(`[${ctx.trace_id}] generate_inflow_periods: created ${write_result.count} periods ` +
            `from ${deps.source_periods.length} source periods in ${perf.time_ms}ms`);
        // 8. ASYNC DEBUG LOGGING
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: span.layer,
            function: span.function,
            status: "success",
            inputs: {
                inflow_id: ctx.input.inflow_id,
                source_period_count: deps.source_periods.length,
            },
            output: {
                periods_created: write_result.count,
            },
            performance: perf,
        }));
        return {
            success: true,
            periods_created: write_result.count,
            trace_id: ctx.trace_id,
        };
    }
    catch (error) {
        const err_msg = error instanceof Error ? error.message : String(error);
        errors.push(`Orchestrator failed: ${err_msg}`);
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(err_msg));
        return {
            success: false,
            periods_created: 0,
            errors,
            trace_id: ctx.trace_id,
        };
    }
}
//# sourceMappingURL=generate_inflow_periods.orchestrator.js.map