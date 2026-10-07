"use strict";
/**
 * Restore Account Transactions Orchestrator
 *
 * Job handler that unhides transactions for a restored account.
 * Reactivates the transactions an account removal hid (paged, 500 per job).
 *
 * @module orchestrators/accounts/restore_account_transactions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.restore_account_transactions_orchestrator = restore_account_transactions_orchestrator;
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const repositories_1 = require("../../repositories");
const derive_version_repo_1 = require("../../repositories/derive_version.repo");
const job_queue_1 = require("../../infrastructure/job_queue");
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
 * Orchestrates restoring (unhiding) transactions for a restored account.
 *
 * This is a job handler - called by the job queue processor.
 *
 * Flow:
 * 1. Reactivate one page (≤500) of the account's removal-hidden transactions
 * 2. Re-enqueue itself while a full page came back
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
        // 1. Restore one page of the transactions the account removal hid. Only
        //    hiddenReason "account_removed" — rows soft-deleted for other reasons
        //    (superseded pendings, etc.) must stay deleted.
        const { restored: restored_count, has_more } = await repositories_1.transaction_repo.restore_for_account(ctx, input.plaid_account_id, input.user_id);
        perf.reads++;
        perf.writes += restored_count;
        if (restored_count === 0) {
            console.log(`[${ctx.trace_id}] No transactions to restore for account ${input.plaid_account_id}`);
            return { success: true, transactions_restored: 0 };
        }
        // A full page means more may remain — continue in a follow-up job.
        if (has_more) {
            await (0, job_queue_1.create_job)("restore_account_transactions", input, { trace_id: input.trace_id });
        }
        // Restored txns re-enter derive — invalidate the cache (TR-2, trigger no longer bumps).
        await (0, derive_version_repo_1.bump_derive_version)(input.user_id).catch(() => { });
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