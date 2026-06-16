"use strict";
/**
 * Job Created Trigger
 *
 * Processes jobs immediately when they are created in the _jobs collection.
 * This provides near-instant processing while the scheduled function serves
 * as a fallback for retries and any missed jobs.
 *
 * @module entry/triggers/on_job_created
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.on_job_created = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const job_queue_1 = require("../../infrastructure/job_queue");
const accounts_1 = require("../../orchestrators/accounts");
const summaries_1 = require("../../orchestrators/summaries");
const budgets_1 = require("../../orchestrators/budgets");
const assign_transaction_orchestrator_1 = require("../../orchestrators/transactions/assign_transaction.orchestrator");
const assign_transactions_batch_orchestrator_1 = require("../../orchestrators/transactions/assign_transactions_batch.orchestrator");
const recompute_budget_spent_orchestrator_1 = require("../../orchestrators/budgets/recompute_budget_spent.orchestrator");
const backfill_assignments_orchestrator_1 = require("../../orchestrators/transactions/backfill_assignments.orchestrator");
const reconcile_recurring_periods_orchestrator_1 = require("../../orchestrators/recurring/reconcile_recurring_periods.orchestrator");
const backfill_recurring_reconciliation_orchestrator_1 = require("../../orchestrators/recurring/backfill_recurring_reconciliation.orchestrator");
const regenerate_recurring_occurrences_orchestrator_1 = require("../../orchestrators/recurring/regenerate_recurring_occurrences.orchestrator");
const assign_recurring_transactions_orchestrator_1 = require("../../orchestrators/recurring/assign_recurring_transactions.orchestrator");
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
    // Transaction Assignment Engine: assign one transaction's splits
    assign_transaction: async (ctx, payload) => {
        await (0, assign_transaction_orchestrator_1.assign_transaction_orchestrator)(ctx, payload);
    },
    // Transaction Assignment Engine (bulk): assign many of a user's transactions
    // with the shared context resolved once (used by the backfill).
    assign_transactions_batch: async (ctx, payload) => {
        await (0, assign_transactions_batch_orchestrator_1.assign_transactions_batch_orchestrator)(ctx, payload);
    },
    // Spend pipeline: recompute budget_period.spent for the touched budgets
    recompute_budget_spent: async (ctx, payload) => {
        await (0, recompute_budget_spent_orchestrator_1.recompute_budget_spent_orchestrator)(ctx, payload);
    },
    // One-shot backfill: re-assign + full-recompute (self-fans per user)
    backfill_assignments: async (ctx, payload) => {
        await (0, backfill_assignments_orchestrator_1.backfill_assignments_orchestrator)(ctx, payload);
    },
    // Recurring reconciliation: recompute a recurring doc's period paid/received status
    reconcile_recurring_period: async (ctx, payload) => {
        await (0, reconcile_recurring_periods_orchestrator_1.reconcile_recurring_periods_orchestrator)(ctx, payload);
    },
    // Recurring reconciliation backfill (self-fans per user → per recurring doc)
    backfill_recurring_reconciliation: async (ctx, payload) => {
        await (0, backfill_recurring_reconciliation_orchestrator_1.backfill_recurring_reconciliation_orchestrator)(ctx, payload);
    },
    // Regenerate a recurring doc's period occurrence data, then reconcile (B).
    regenerate_recurring_occurrences: async (ctx, payload) => {
        await (0, regenerate_recurring_occurrences_orchestrator_1.regenerate_recurring_occurrences_orchestrator)(ctx, payload);
    },
    // Re-assign a newly-created recurring item's transactions (set split outflow/inflow id).
    assign_recurring_transactions: async (ctx, payload) => {
        await (0, assign_recurring_transactions_orchestrator_1.assign_recurring_transactions_orchestrator)(ctx, payload);
    },
};
/**
 * Trigger: Process job immediately when created
 *
 * This trigger fires when a new job is added to the _jobs collection.
 * It attempts to claim and process the job immediately, providing
 * near-instant execution instead of waiting for the scheduled function.
 */
exports.on_job_created = (0, firestore_1.onDocumentCreated)({
    document: "_jobs/{jobId}",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 300, // 5 minutes max for job processing
}, async (event) => {
    var _a;
    const job_id = event.params.jobId;
    const job_data = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
    if (!job_data) {
        console.error(`[on_job_created] No job data found for ${job_id}`);
        return;
    }
    // Skip if job is scheduled for the future
    if (job_data.scheduled_for && job_data.scheduled_for.toMillis() > Date.now()) {
        console.log(`[on_job_created] Job ${job_id} scheduled for future, skipping immediate processing`);
        return;
    }
    // Skip the routine per-job line for the highest-volume type (summary
    // updates) to keep logs capturable; other types still log for tracing.
    if (job_data.job_type !== "update_user_summary") {
        console.log(`[on_job_created] Processing job ${job_id} of type ${job_data.job_type}`);
    }
    try {
        // Claim the job atomically (prevents duplicate processing)
        const claimed_job = await (0, job_queue_1.claim_job)(job_id);
        if (!claimed_job) {
            console.log(`[on_job_created] Job ${job_id} already claimed or not pending, skipping`);
            return;
        }
        // Find the handler
        const handler = JOB_HANDLERS[job_data.job_type];
        if (!handler) {
            console.error(`[on_job_created] Unknown job type: ${job_data.job_type}`);
            await (0, job_queue_1.mark_job_failed)(job_id, `Unknown job type: ${job_data.job_type}`);
            return;
        }
        // Execute the handler
        const job_ctx = {
            trace_id: job_data.trace_id || job_id,
            span_id: job_id,
        };
        await handler(job_ctx, claimed_job.payload);
        // Mark as completed (success is intentionally not logged — high volume;
        // failures below are logged. The orchestrators log their own outcomes.)
        await (0, job_queue_1.mark_job_completed)(job_id);
    }
    catch (error) {
        console.error(`[on_job_created] Job ${job_id} failed:`, error);
        const error_message = error instanceof Error
            ? error.message
            : "Unknown error";
        const will_retry = await (0, job_queue_1.mark_job_failed)(job_id, error_message);
        if (will_retry) {
            console.log(`[on_job_created] Job ${job_id} scheduled for retry (will be picked up by scheduled function)`);
        }
        else {
            console.log(`[on_job_created] Job ${job_id} moved to DLQ`);
        }
    }
});
//# sourceMappingURL=on_job_created.trigger.js.map