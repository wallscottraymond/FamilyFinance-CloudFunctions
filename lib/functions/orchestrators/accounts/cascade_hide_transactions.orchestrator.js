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
        // Control-flow decision: delete-history removal also drops the txns from
        // budgets. The repo persists the computed hide fields (one page of ≤500).
        const exclude_from_budgets = input.removal_mode === "delete_history";
        const { hidden: total_hidden, has_more } = await transaction_repo_1.transaction_repo.hide_for_account(ctx, input.plaid_account_id, input.user_id, exclude_from_budgets);
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
            `has_more=${has_more}, exclude_from_budgets=${exclude_from_budgets}`);
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