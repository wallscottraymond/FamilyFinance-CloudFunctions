"use strict";
/**
 * Cascade Soft Delete Recurring Orchestrator
 *
 * Job handler that soft-deletes all recurring outflows and inflows
 * for a removed account.
 *
 * @module orchestrators/accounts/cascade_soft_delete_recurring
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cascade_soft_delete_recurring_orchestrator = cascade_soft_delete_recurring_orchestrator;
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const outflow_repo_1 = require("../../repositories/outflow.repo");
const inflow_repo_1 = require("../../repositories/inflow.repo");
const outflow_period_repo_1 = require("../../repositories/outflow_period.repo");
const inflow_period_repo_1 = require("../../repositories/inflow_period.repo");
/**
 * Performance budget for cascade operation.
 * Note: Used for documentation/reference, actual enforcement TBD.
 */
const _BUDGET = {
    max_reads: 20,
    max_writes: 100,
    max_time_ms: 15000,
};
void _BUDGET; // Referenced for documentation
/**
 * Orchestrates soft-deleting recurring items for a removed account.
 *
 * This is designed to be idempotent - running multiple times
 * with the same input will produce the same result.
 *
 * @param ctx - Trace context
 * @param input - Job input
 * @returns Result with counts
 */
async function cascade_soft_delete_recurring_orchestrator(ctx, input) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "cascade_soft_delete_recurring");
    const perf = (0, types_1.create_performance_metrics)();
    (0, observability_1.log_operation_start)(span, input.user_id);
    try {
        let outflows_deleted = 0;
        let inflows_deleted = 0;
        // Soft-delete outflows
        for (const outflow_id of input.outflow_ids) {
            try {
                // Check if already soft-deleted (idempotent)
                const outflow = await outflow_repo_1.outflow_repo.get_by_id(ctx, outflow_id);
                perf.reads++;
                if (outflow && outflow.is_active) {
                    await outflow_repo_1.outflow_repo.soft_delete(ctx, outflow_id, input.user_id);
                    perf.writes++;
                    outflows_deleted++;
                }
            }
            catch (error) {
                // Log but continue with other outflows
                console.error(`[${ctx.trace_id}] Failed to soft-delete outflow ${outflow_id}:`, error);
            }
        }
        // Soft-delete inflows
        for (const inflow_id of input.inflow_ids) {
            try {
                // Check if already soft-deleted (idempotent)
                const inflow = await inflow_repo_1.inflow_repo.get_by_id(ctx, inflow_id);
                perf.reads++;
                if (inflow && inflow.is_active) {
                    await inflow_repo_1.inflow_repo.soft_delete(ctx, inflow_id, input.user_id);
                    perf.writes++;
                    inflows_deleted++;
                }
            }
            catch (error) {
                // Log but continue with other inflows
                console.error(`[${ctx.trace_id}] Failed to soft-delete inflow ${inflow_id}:`, error);
            }
        }
        // Soft-delete the periods belonging to this account. Periods carry their own
        // `accountId`, so we deactivate by account in one shot (rather than per
        // recurring id) — this also catches periods whose parent was already
        // soft-deleted. Without this the periods stay `isActive: true` and keep
        // showing on the period views after the account is removed.
        const outflow_periods_deleted = await outflow_period_repo_1.outflow_period_repo.set_active_by_account_id(ctx, input.plaid_account_id, false);
        const inflow_periods_deleted = await inflow_period_repo_1.inflow_period_repo.set_active_by_account_id(ctx, input.plaid_account_id, false);
        perf.reads += 2;
        perf.writes += outflow_periods_deleted + inflow_periods_deleted;
        (0, observability_1.log_operation_success)(span, input.user_id);
        // Async debug logging
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: "orchestrator",
            function: "cascade_soft_delete_recurring",
            status: "success",
            context: {
                plaid_account_id: input.plaid_account_id,
                outflows_deleted,
                inflows_deleted,
                outflow_periods_deleted,
                inflow_periods_deleted,
                outflows_requested: input.outflow_ids.length,
                inflows_requested: input.inflow_ids.length,
                perf_reads: perf.reads,
                perf_writes: perf.writes,
            },
        }));
        console.log(`[${ctx.trace_id}] cascade_soft_delete_recurring: ` +
            `outflows=${outflows_deleted}/${input.outflow_ids.length}, ` +
            `inflows=${inflows_deleted}/${input.inflow_ids.length}, ` +
            `outflow_periods=${outflow_periods_deleted}, inflow_periods=${inflow_periods_deleted}`);
        return {
            outflows_deleted,
            inflows_deleted,
            outflow_periods_deleted,
            inflow_periods_deleted,
            success: true,
        };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: input.user_id, error_code: "CASCADE_SOFT_DELETE_RECURRING_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=cascade_soft_delete_recurring.orchestrator.js.map