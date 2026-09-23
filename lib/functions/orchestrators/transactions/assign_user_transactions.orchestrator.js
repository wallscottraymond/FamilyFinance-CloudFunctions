"use strict";
/**
 * Assign User Transactions (debounced batch) Orchestrator
 *
 * Replaces the per-transaction assignment fan-out on sync. `on_transaction_written` used to enqueue
 * ONE singular `assign_transaction` job per changed txn, and each re-read the ENTIRE reference set
 * (budgets + outflows + inflows + categories + source_periods) PLUS the `outflow_periods`/
 * `inflow_periods` recurring-candidate scans — so a Plaid-sync of N txns cost O(N × every reference
 * collection). That was the top Firestore read line (outflow_periods > 2× transactions).
 *
 * Instead, the trigger enqueues ONE debounced job per user (dedup `assign_user:{uid}`). This job
 * reads the user's watermark, fetches the transactions changed since it, and assigns them all via
 * `assign_transactions_batch` — which resolves the shared context ONCE and preloads the recurring
 * candidates ONCE. Reference reads drop from O(N) to O(1) per sync.
 *
 * Watermark advances ONLY on success (a failed/retried run re-processes from the old cursor, so no
 * txn is ever stranded). If a run hits the page cap there are more to do, so it re-enqueues itself.
 *
 * @module orchestrators/transactions/assign_user_transactions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.assign_user_transactions_orchestrator = assign_user_transactions_orchestrator;
const observability_1 = require("../../observability");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const assignment_watermark_repo_1 = require("../../repositories/assignment_watermark.repo");
const assign_transactions_batch_orchestrator_1 = require("./assign_transactions_batch.orchestrator");
const job_queue_1 = require("../../infrastructure/job_queue");
/** Max txns assigned per run. A sync burst above this re-enqueues to continue. */
const PAGE_LIMIT = 3000;
/** First-run lookback when no watermark exists — bounds the very first pass. */
const INITIAL_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
async function assign_user_transactions_orchestrator(ctx, input) {
    var _a;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "assign_user_transactions");
    (0, observability_1.log_operation_start)(span, input.user_id);
    try {
        const watermark_ms = (_a = (await (0, assignment_watermark_repo_1.get_assignment_watermark_ms)(input.user_id))) !== null && _a !== void 0 ? _a : Date.now() - INITIAL_LOOKBACK_MS;
        const changed = await transaction_repo_1.transaction_repo.get_ids_updated_since(ctx, input.user_id, watermark_ms, PAGE_LIMIT);
        if (changed.length === 0) {
            (0, observability_1.log_operation_success)(span, input.user_id);
            return { assigned: 0, more: false };
        }
        // One batch = shared context + recurring candidates resolved ONCE for all of these txns.
        await (0, assign_transactions_batch_orchestrator_1.assign_transactions_batch_orchestrator)(ctx, {
            user_id: input.user_id,
            transaction_ids: changed.map((c) => c.id),
        });
        // Advance ONLY on success, to the last processed txn's updatedAt (never past unprocessed rows).
        const last_ms = changed[changed.length - 1].updated_ms;
        await (0, assignment_watermark_repo_1.set_assignment_watermark_ms)(input.user_id, last_ms);
        const more = changed.length === PAGE_LIMIT;
        if (more) {
            // More changed txns than one page — continue in a follow-up run (deduped).
            await (0, job_queue_1.create_job_if_not_exists)("assign_user_transactions", { deduplication_key: `assign_user:${input.user_id}`, user_id: input.user_id }, { trace_id: ctx.trace_id, delay_seconds: 5 });
        }
        console.log(`[${ctx.trace_id}] assign_user_transactions: user=${input.user_id} ` +
            `assigned=${changed.length} more=${more} watermark=${new Date(last_ms).toISOString()}`);
        (0, observability_1.log_operation_success)(span, input.user_id);
        return { assigned: changed.length, more };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { error_code: "ASSIGN_USER_TRANSACTIONS_FAILED" });
        throw error; // let the job queue retry from the un-advanced watermark
    }
}
//# sourceMappingURL=assign_user_transactions.orchestrator.js.map