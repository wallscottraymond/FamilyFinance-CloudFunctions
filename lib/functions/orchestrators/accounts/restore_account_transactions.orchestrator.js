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
const job_queue_1 = require("../../infrastructure/job_queue");
const sync_follow_ups_1 = require("../plaid/sync_follow_ups");
const tracer_1 = require("../../observability/tracer");
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
        // 0. Page-by-page job: if the account was removed again in between, stop (P1-M8).
        const account = await repositories_1.account_repo.get_by_plaid_account_id_any_status(ctx, input.plaid_account_id, input.user_id);
        perf.reads++;
        if (account && !account.is_active) {
            console.log(`[${ctx.trace_id}] Account ${input.plaid_account_id} is removed — not restoring`);
            return { success: true, transactions_restored: 0 };
        }
        // 1. Restore one page of the transactions the account removal hid. Only
        //    hiddenReason "account_removed" — rows soft-deleted for other reasons
        //    (superseded pendings, etc.) must stay deleted.
        // One stamped page + ONE follow-up pass (rule 1.2a.3; Code-Health-Review P1-M3).
        const { restored: restored_count, has_more, written } = await repositories_1.transaction_repo.restore_for_account(ctx, input.plaid_account_id, input.user_id, `account_restore:${(0, tracer_1.generate_id)()}`);
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
        // The page's follow-ups (spent, bills / income, one derive bump) — and, since budgets may have
        // changed while the account was hidden, ONE debounced assignment batch for the user (what the
        // per-transaction trigger used to queue once per write).
        await (0, sync_follow_ups_1.run_sync_follow_ups)(ctx, input.user_id, (0, sync_follow_ups_1.follow_ups_from_written)(written));
        await (0, job_queue_1.coalesce_job)("assign_user_transactions", { deduplication_key: `assign_user:${input.user_id}`, user_id: input.user_id }, { trace_id: ctx.trace_id, delay_seconds: 15 });
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