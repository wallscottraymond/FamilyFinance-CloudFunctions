"use strict";
/**
 * Process Job Queue Scheduled Function
 *
 * Runs periodically to process pending jobs in the queue.
 * Handles cascade operations for account removal and other async work.
 *
 * @module entry/scheduled/process_job_queue
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.process_job_queue = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const job_queue_1 = require("../../infrastructure/job_queue");
const observability_1 = require("../../observability");
const accounts_1 = require("../../orchestrators/accounts");
const summaries_1 = require("../../orchestrators/summaries");
const budgets_1 = require("../../orchestrators/budgets");
const assign_transaction_orchestrator_1 = require("../../orchestrators/transactions/assign_transaction.orchestrator");
const recompute_budget_spent_orchestrator_1 = require("../../orchestrators/budgets/recompute_budget_spent.orchestrator");
const backfill_assignments_orchestrator_1 = require("../../orchestrators/transactions/backfill_assignments.orchestrator");
/**
 * Maximum jobs to process per invocation.
 */
const MAX_JOBS_PER_RUN = 10;
const JOB_HANDLERS = {
    // Account removal cascade jobs
    cascade_hide_transactions: async (ctx, payload) => {
        const input = payload;
        await (0, accounts_1.cascade_hide_transactions_orchestrator)(ctx, input);
    },
    cascade_soft_delete_recurring: async (ctx, payload) => {
        const input = payload;
        await (0, accounts_1.cascade_soft_delete_recurring_orchestrator)(ctx, input);
    },
    // Account restore jobs
    restore_account_transactions: async (ctx, payload) => {
        const input = payload;
        await (0, accounts_1.restore_account_transactions_orchestrator)(ctx, input);
    },
    restore_account_recurring: async (ctx, payload) => {
        const input = payload;
        await (0, accounts_1.restore_account_recurring_orchestrator)(ctx, input);
    },
    // User summary update job
    // This serializes summary updates to prevent race conditions when multiple
    // triggers fire simultaneously for the same user summary
    update_user_summary: async (ctx, payload) => {
        const input = payload;
        await (0, summaries_1.update_user_summary_orchestrator)({
            trace_id: ctx.trace_id,
            span_id: ctx.span_id,
            input: {
                user_id: input.user_id,
                period_type: input.period_type,
                source_period_id: input.source_period_id,
            },
        });
    },
    // Budget CRUD cascade jobs
    process_budget_created: async (ctx, payload) => {
        await (0, budgets_1.process_budget_created_orchestrator)(ctx, payload);
    },
    process_budget_updated: async (ctx, payload) => {
        await (0, budgets_1.process_budget_updated_orchestrator)(ctx, payload);
    },
    process_budget_deleted: async (ctx, payload) => {
        await (0, budgets_1.process_budget_deleted_orchestrator)(ctx, payload);
    },
    // Transaction Assignment Engine + spend pipeline + backfill. Registered here
    // (not just in on_job_created) so a retried/missed engine job is processed by
    // the fallback worker instead of dead-lettering.
    assign_transaction: async (ctx, payload) => {
        await (0, assign_transaction_orchestrator_1.assign_transaction_orchestrator)(ctx, payload);
    },
    recompute_budget_spent: async (ctx, payload) => {
        await (0, recompute_budget_spent_orchestrator_1.recompute_budget_spent_orchestrator)(ctx, payload);
    },
    backfill_assignments: async (ctx, payload) => {
        await (0, backfill_assignments_orchestrator_1.backfill_assignments_orchestrator)(ctx, payload);
    },
};
/**
 * Scheduled function to process the job queue.
 *
 * Runs every minute to check for pending jobs.
 * Claims jobs atomically to prevent duplicate processing.
 */
exports.process_job_queue = (0, scheduler_1.onSchedule)({
    schedule: "every 1 minutes",
    timeoutSeconds: 540, // 9 minutes
    memory: "512MiB",
}, async () => {
    const ctx = (0, observability_1.create_trace_context)(false);
    const span = (0, observability_1.create_span)(ctx, "entry", "process_job_queue");
    (0, observability_1.log_operation_start)(span, "system");
    let processed = 0;
    let failed = 0;
    try {
        // Get pending jobs
        const pending_jobs = await (0, job_queue_1.get_pending_jobs)(undefined, MAX_JOBS_PER_RUN);
        if (pending_jobs.length === 0) {
            console.log(`[${ctx.trace_id}] No pending jobs to process`);
            return;
        }
        console.log(`[${ctx.trace_id}] Found ${pending_jobs.length} pending jobs to process`);
        // Process each job
        for (const job of pending_jobs) {
            try {
                // Claim the job atomically
                const claimed_job = await (0, job_queue_1.claim_job)(job.job_id);
                if (!claimed_job) {
                    console.log(`[${ctx.trace_id}] Job ${job.job_id} already claimed, skipping`);
                    continue;
                }
                console.log(`[${ctx.trace_id}] Processing job ${job.job_id} of type ${job.job_type}`);
                // Find the handler
                const handler = JOB_HANDLERS[job.job_type];
                if (!handler) {
                    console.error(`[${ctx.trace_id}] Unknown job type: ${job.job_type}`);
                    await (0, job_queue_1.mark_job_failed)(job.job_id, `Unknown job type: ${job.job_type}`);
                    failed++;
                    continue;
                }
                // Execute the handler
                const job_ctx = {
                    trace_id: claimed_job.trace_id || ctx.trace_id,
                    span_id: job.job_id,
                };
                await handler(job_ctx, claimed_job.payload);
                // Mark as completed
                await (0, job_queue_1.mark_job_completed)(job.job_id);
                processed++;
                console.log(`[${ctx.trace_id}] Job ${job.job_id} completed successfully`);
            }
            catch (error) {
                console.error(`[${ctx.trace_id}] Job ${job.job_id} failed:`, error);
                const error_message = error instanceof Error
                    ? error.message
                    : "Unknown error";
                const will_retry = await (0, job_queue_1.mark_job_failed)(job.job_id, error_message);
                if (will_retry) {
                    console.log(`[${ctx.trace_id}] Job ${job.job_id} scheduled for retry`);
                }
                else {
                    console.log(`[${ctx.trace_id}] Job ${job.job_id} moved to DLQ`);
                }
                failed++;
            }
        }
        (0, observability_1.log_operation_success)(span, "system");
        console.log(`[${ctx.trace_id}] Job queue processing complete: ` +
            `processed=${processed}, failed=${failed}`);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: "system", error_code: "JOB_QUEUE_PROCESSING_FAILED" });
        throw error;
    }
});
//# sourceMappingURL=process_job_queue.scheduled.js.map