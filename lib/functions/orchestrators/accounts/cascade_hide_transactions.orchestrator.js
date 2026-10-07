"use strict";
/**
 * Cascade Hide Transactions Orchestrator
 *
 * Job handler that hides all transactions for a removed account.
 * Called asynchronously after account removal.
 *
 * @module orchestrators/accounts/cascade_hide_transactions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cascade_hide_transactions_orchestrator = cascade_hide_transactions_orchestrator;
const types_1 = require("../../types");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const derive_version_repo_1 = require("../../repositories/derive_version.repo");
const job_queue_1 = require("../../infrastructure/job_queue");
const observability_1 = require("../../observability");
/**
 * Performance budget for cascade operation.
 * Note: Used for documentation/reference, actual enforcement TBD.
 */
const _BUDGET = {
    max_reads: 50,
    max_writes: 500, // May need to update many transactions
    max_time_ms: 30000, // 30 seconds for batch operations
};
void _BUDGET; // Referenced for documentation
/**
 * Orchestrates hiding transactions for a removed account.
 *
 * This is designed to be idempotent - running multiple times
 * with the same input will produce the same result.
 *
 * @param ctx - Trace context
 * @param input - Job input
 * @returns Result with count of hidden transactions
 */
async function cascade_hide_transactions_orchestrator(ctx, input) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "cascade_hide_transactions");
    const perf = (0, types_1.create_performance_metrics)();
    (0, observability_1.log_operation_start)(span, input.user_id);
    try {
        // Removing an account removes its transactions from budgets too (decided
        // 2026-10-05; the "Keep in Budgets" choice was dropped — it never worked,
        // since derive ignores inactive transactions). `removal_mode` stays on the
        // payload only for older app builds. One page of ≤500 per run.
        const { hidden: total_hidden, has_more } = await transaction_repo_1.transaction_repo.hide_for_account(ctx, input.plaid_account_id, input.user_id);
        perf.reads++;
        perf.writes += total_hidden;
        if (total_hidden === 0) {
            (0, observability_1.log_operation_success)(span, input.user_id);
            return {
                transactions_hidden: 0,
                has_more: false,
                success: true,
            };
        }
        // Hidden txns drop out of derive — invalidate the cache (TR-2, trigger no longer bumps).
        // One bump per page; a paginated cascade re-invokes this handler and bumps each page.
        await (0, derive_version_repo_1.bump_derive_version)(input.user_id).catch(() => { });
        // A full page means more may remain — continue in a follow-up job (the
        // account had 5k+ transactions; only the first 500 used to be hidden).
        if (has_more) {
            await (0, job_queue_1.create_job)("cascade_hide_transactions", input, { trace_id: input.trace_id });
        }
        (0, observability_1.log_operation_success)(span, input.user_id);
        // Async debug logging
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: "orchestrator",
            function: "cascade_hide_transactions",
            status: "success",
            context: {
                plaid_account_id: input.plaid_account_id,
                removal_mode: input.removal_mode,
                transactions_hidden: total_hidden,
                has_more,
                perf_reads: perf.reads,
                perf_writes: perf.writes,
            },
        }));
        console.log(`[${ctx.trace_id}] cascade_hide_transactions: hidden=${total_hidden}, ` +
            `has_more=${has_more}`);
        return {
            transactions_hidden: total_hidden,
            has_more,
            success: true,
        };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: input.user_id, error_code: "CASCADE_HIDE_TRANSACTIONS_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=cascade_hide_transactions.orchestrator.js.map