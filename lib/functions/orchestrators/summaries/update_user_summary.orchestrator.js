"use strict";
/**
 * Update User Summary Orchestrator
 *
 * Coordinates the update of user period summaries following the 5-layer architecture:
 * Entry → Orchestrator → Resolver → Domain → Repository
 *
 * @module orchestrators/summaries/update_user_summary
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.UPDATE_USER_SUMMARY_BUDGET = void 0;
exports.update_user_summary_orchestrator = update_user_summary_orchestrator;
exports.enqueue_user_summary_updates_by_type = enqueue_user_summary_updates_by_type;
exports.enqueue_user_summary_updates_from_outflow_periods = enqueue_user_summary_updates_from_outflow_periods;
exports.enqueue_user_summary_updates_from_inflow_periods = enqueue_user_summary_updates_from_inflow_periods;
exports.enqueue_user_summary_updates_from_budget_periods = enqueue_user_summary_updates_from_budget_periods;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const summaries_1 = require("../../resolvers/summaries");
const summaries_2 = require("../../domain/summaries");
const user_summary_repo_1 = require("../../repositories/user_summary.repo");
const job_queue_1 = require("../../infrastructure/job_queue");
// ============================================================================
// PERFORMANCE BUDGET
// ============================================================================
/**
 * Performance budget for user summary update.
 */
exports.UPDATE_USER_SUMMARY_BUDGET = {
    max_reads: 10, // 1 source period + 3 resource collections
    max_writes: 1, // 1 summary document
    max_time_ms: 3000, // 3 seconds
};
// ============================================================================
// SINGLE SUMMARY UPDATE ORCHESTRATOR
// ============================================================================
/**
 * Update a single user period summary.
 *
 * Follows the 5-layer architecture:
 * 1. Resolver: Fetch source period and all resource periods
 * 2. Domain: Compute summary from resource periods (PURE)
 * 3. Domain: Validate summary (PURE)
 * 4. Repository: Save summary to Firestore
 *
 * @param ctx - Orchestrator context with trace info and input
 * @returns Result with summary ID or errors
 */
async function update_user_summary_orchestrator(ctx) {
    const start_time = Date.now();
    const perf = (0, types_1.create_performance_metrics)();
    const errors = [];
    // Create span for this orchestrator
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "update_user_summary");
    (0, observability_1.log_operation_start)(span, ctx.input.user_id);
    // Build summary ID
    const normalized_period_type = ctx.input.period_type.toLowerCase();
    const summary_id = `${ctx.input.user_id}_${normalized_period_type}_${ctx.input.source_period_id}`;
    let final_summary_id = null;
    let outflow_count = 0;
    let budget_count = 0;
    let inflow_count = 0;
    try {
        // Use transactional save to prevent race conditions
        // The transaction will:
        // 1. Read the existing summary (establishes conflict detection)
        // 2. Read all dependent period documents
        // 3. Compute the new summary with fresh data
        // 4. Write atomically
        // If the summary changes between read and write, Firestore retries automatically
        await user_summary_repo_1.user_summary_repo.save_with_transaction(ctx, summary_id, ctx.input.user_id, ctx.input.source_period_id, ctx.input.period_type, (deps) => {
            var _a, _b, _c, _d;
            // Track counts for logging
            outflow_count = deps.outflow_periods.length;
            budget_count = deps.budget_periods.length;
            inflow_count = deps.inflow_periods.length;
            // COMPUTE SUMMARY (Domain Service - PURE)
            const now = firestore_1.Timestamp.now();
            const compute_result = (0, summaries_2.compute_user_period_summary)({
                user_id: ctx.input.user_id,
                source_period: deps.source_period,
                outflow_periods: deps.outflow_periods,
                budget_periods: deps.budget_periods,
                inflow_periods: deps.inflow_periods,
                now,
            });
            if ((0, types_1.has_errors)(compute_result)) {
                throw new Error((_b = (_a = compute_result.validation_errors) === null || _a === void 0 ? void 0 : _a.join("; ")) !== null && _b !== void 0 ? _b : "Compute failed");
            }
            const summary = compute_result.entity;
            // VALIDATE SUMMARY (Domain Service - PURE)
            const validation_result = (0, summaries_2.validate_user_period_summary)(summary);
            if ((0, types_1.has_errors)(validation_result)) {
                throw new Error((_d = (_c = validation_result.validation_errors) === null || _c === void 0 ? void 0 : _c.join("; ")) !== null && _d !== void 0 ? _d : "Validation failed");
            }
            final_summary_id = summary.id;
            return summary;
        });
        perf.reads += 4; // 1 summary + 1 source period + 3 resource queries (inside transaction)
        perf.writes += 1;
        // CHECK PERFORMANCE BUDGET
        perf.time_ms = Date.now() - start_time;
        if ((0, types_1.is_budget_exceeded)(perf, exports.UPDATE_USER_SUMMARY_BUDGET)) {
            console.warn(`[${ctx.trace_id}] update_user_summary: Performance budget exceeded`, { perf, budget: exports.UPDATE_USER_SUMMARY_BUDGET });
        }
        // LOG SUCCESS (structured span only — per-job console line removed for volume)
        (0, observability_1.log_operation_success)(span, ctx.input.user_id);
        // ASYNC DEBUG LOGGING
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: span.layer,
            function: span.function,
            status: "success",
            inputs: ctx.input,
            output: {
                summary_id: final_summary_id,
                outflow_count,
                budget_count,
                inflow_count,
            },
            performance: perf,
        }));
        return {
            success: true,
            summary_id: final_summary_id,
            trace_id: ctx.trace_id,
        };
    }
    catch (error) {
        const err_msg = error instanceof Error ? error.message : String(error);
        errors.push(`Orchestrator failed: ${err_msg}`);
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(err_msg));
        return {
            success: false,
            summary_id: null,
            errors,
            trace_id: ctx.trace_id,
        };
    }
}
/**
 * Shared graph node: enqueue one deduplicated `update_user_summary` job per
 * affected (period_type, source_period_id) pair.
 *
 * This is the SINGLE entry point through which every summary-affecting change
 * (inflow, outflow, budget — whether from a generation cascade or a period
 * trigger) flows. Each job is processed by the `update_user_summary`
 * orchestrator, whose transactional repository recomputes the summary from all
 * sources. The deduplication key collapses redundant updates for the same
 * summary while one is already pending, preventing overlap.
 *
 * @param ctx - Trace context
 * @param user_id - The user ID
 * @param periods_by_type - Map of period_type → set of source_period_ids
 * @returns Count of jobs enqueued (excludes deduplicated no-ops)
 */
async function enqueue_summary_update_jobs(ctx, user_id, periods_by_type) {
    let enqueued = 0;
    for (const [period_type, source_period_ids] of periods_by_type.entries()) {
        const normalized_period_type = period_type.toLowerCase();
        for (const source_period_id of source_period_ids) {
            const deduplication_key = `${user_id}_${normalized_period_type}_${source_period_id}`;
            const job = await (0, job_queue_1.create_job_if_not_exists)("update_user_summary", {
                user_id,
                period_type,
                source_period_id,
                deduplication_key,
            }, { trace_id: ctx.trace_id });
            if (job) {
                enqueued += 1;
            }
        }
    }
    return enqueued;
}
/**
 * Enqueue user-summary update jobs from already-resolved (period_type,
 * source_period) pairs. Use this when the underlying period documents are about
 * to be (or have been) deleted, so they can't be resolved by ID — e.g. the
 * budget delete cascade captures the pairs before deletion and enqueues after.
 *
 * @param ctx - Trace context
 * @param user_id - The user ID
 * @param periods_by_type - Map of period_type → set of source_period_ids
 * @returns Count of jobs enqueued
 */
async function enqueue_user_summary_updates_by_type(ctx, user_id, periods_by_type) {
    const enqueued = await enqueue_summary_update_jobs(ctx, user_id, periods_by_type);
    console.log(`[${ctx.trace_id}] enqueue_user_summary_updates_by_type: ` +
        `enqueued ${enqueued} summary jobs`);
    return enqueued;
}
/**
 * Enqueue user-summary update jobs for the given outflow periods.
 * Graph-oriented: routes through the shared `update_user_summary` job node.
 *
 * @param ctx - Trace context
 * @param user_id - The user ID
 * @param outflow_period_ids - Array of outflow_period document IDs
 * @returns Count of jobs enqueued
 */
async function enqueue_user_summary_updates_from_outflow_periods(ctx, user_id, outflow_period_ids) {
    const { periods_by_type } = await (0, summaries_1.resolve_outflow_periods_for_summary)(ctx, outflow_period_ids);
    const enqueued = await enqueue_summary_update_jobs(ctx, user_id, periods_by_type);
    console.log(`[${ctx.trace_id}] enqueue_user_summary_updates_from_outflow_periods: ` +
        `enqueued ${enqueued} summary jobs`);
    return enqueued;
}
// ============================================================================
// CONVENIENCE FUNCTION FOR INFLOW PERIOD UPDATES
// ============================================================================
/**
 * Update user summaries from inflow period IDs.
 *
 * Convenience function that extracts period info from inflow_period documents
 * and updates the corresponding user summaries.
 *
 * Uses the period_lookup.resolver for proper layer separation.
 *
 * @param ctx - Trace context
 * @param user_id - The user ID
 * @param inflow_period_ids - Array of inflow_period document IDs
 * @returns Count of summaries updated
 */
async function enqueue_user_summary_updates_from_inflow_periods(ctx, user_id, inflow_period_ids) {
    const { periods_by_type } = await (0, summaries_1.resolve_inflow_periods_for_summary)(ctx, inflow_period_ids);
    const enqueued = await enqueue_summary_update_jobs(ctx, user_id, periods_by_type);
    console.log(`[${ctx.trace_id}] enqueue_user_summary_updates_from_inflow_periods: ` +
        `enqueued ${enqueued} summary jobs`);
    return enqueued;
}
// ============================================================================
// CONVENIENCE FUNCTION FOR BUDGET PERIOD UPDATES
// ============================================================================
/**
 * Enqueue user-summary update jobs for the given budget periods.
 * Graph-oriented: routes through the shared `update_user_summary` job node.
 *
 * @param ctx - Trace context
 * @param user_id - The user ID
 * @param budget_period_ids - Array of budget_period document IDs
 * @returns Count of jobs enqueued
 */
async function enqueue_user_summary_updates_from_budget_periods(ctx, user_id, budget_period_ids) {
    const { periods_by_type } = await (0, summaries_1.resolve_budget_periods_for_summary)(ctx, budget_period_ids);
    const enqueued = await enqueue_summary_update_jobs(ctx, user_id, periods_by_type);
    console.log(`[${ctx.trace_id}] enqueue_user_summary_updates_from_budget_periods: ` +
        `enqueued ${enqueued} summary jobs`);
    return enqueued;
}
//# sourceMappingURL=update_user_summary.orchestrator.js.map