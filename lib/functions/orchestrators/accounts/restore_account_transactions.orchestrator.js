"use strict";
/**
 * Restore Account Transactions Orchestrator
 *
 * Job handler that unhides transactions for a restored account.
 * Sets `isHidden: false` on all transactions for the account.
 *
 * @module orchestrators/accounts/restore_account_transactions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.restore_account_transactions_orchestrator = restore_account_transactions_orchestrator;
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const repositories_1 = require("../../repositories");
/**
 * Performance budget for restore_account_transactions job.
 */
const _BUDGET = {
    max_reads: 50,
    max_writes: 500,
    max_time_ms: 30000,
};
void _BUDGET; // Reserved for future budget checking
/**
 * Batch size for transaction updates.
 */
const BATCH_SIZE = 500;
/**
 * Orchestrates restoring (unhiding) transactions for a restored account.
 *
 * This is a job handler - called by the job queue processor.
 *
 * Flow:
 * 1. Get hidden transaction IDs for the account
 * 2. Batch update to set isHidden: false
 *
 * @param ctx - Trace context (from job payload)
 * @param input - Job input
 * @returns Restore result
 */
async function restore_account_transactions_orchestrator(ctx, input) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "restore_account_transactions");
    const perf = (0, types_1.create_performance_metrics)();
    (0, observability_1.log_operation_start)(span, input.user_id);
    try {
        // 1. Get hidden transaction IDs for this account. Account removal set them
        //    to isActive: false, so we MUST include soft-deleted rows here or the
        //    query comes back empty and nothing gets restored.
        const transaction_ids = await repositories_1.transaction_repo.get_ids_by_account_id(ctx, input.plaid_account_id, input.user_id, BATCH_SIZE * 10, // Allow larger batches for restore
        { include_deleted: true });
        perf.reads++;
        if (transaction_ids.length === 0) {
            console.log(`[${ctx.trace_id}] No transactions to restore for account ${input.plaid_account_id}`);
            return { success: true, transactions_restored: 0 };
        }
        console.log(`[${ctx.trace_id}] Restoring ${transaction_ids.length} transactions for account ${input.plaid_account_id}`);
        // 2. Reactivate + unhide via the repo. Account removal set isActive: false
        //    and the hide markers, so restore must reverse both. We don't touch
        //    excludeFromBudgets — that's a user choice that persists across
        //    hide/restore.
        /* eslint-disable @typescript-eslint/naming-convention */
        const restored_count = await repositories_1.transaction_repo.set_fields_by_ids(ctx, transaction_ids, {
            isActive: true,
            isHidden: false,
            hiddenReason: null,
            hiddenAt: null,
        });
        /* eslint-enable @typescript-eslint/naming-convention */
        perf.writes += Math.ceil(restored_count / BATCH_SIZE);
        (0, observability_1.log_operation_success)(span, input.user_id);
        // 3. Async debug logging
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: "orchestrator",
            function: "restore_account_transactions",
            status: "success",
            context: {
                account_id: input.plaid_account_id,
                transactions_restored: restored_count,
                perf_reads: perf.reads,
                perf_writes: perf.writes,
            },
        }));
        console.log(`[${ctx.trace_id}] restore_account_transactions: ` +
            `account=${input.plaid_account_id}, restored=${restored_count}`);
        return {
            success: true,
            transactions_restored: restored_count,
        };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: input.user_id, error_code: "RESTORE_TRANSACTIONS_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=restore_account_transactions.orchestrator.js.map