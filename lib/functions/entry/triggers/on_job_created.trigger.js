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
const sync_item_orchestrator_1 = require("../../orchestrators/plaid/sync_item.orchestrator");
const firestore_1 = require("firebase-functions/v2/firestore");
const params_1 = require("firebase-functions/params");
const job_queue_1 = require("../../infrastructure/job_queue");
const purge_user_data_orchestrator_1 = require("../../orchestrators/users/purge_user_data.orchestrator");
// Bound because the purge_user_data job revokes Plaid access tokens
// (decrypt + /item/remove) from inside this job runner.
const PLAID_CLIENT_ID = (0, params_1.defineSecret)("PLAID_CLIENT_ID");
const PLAID_SECRET = (0, params_1.defineSecret)("PLAID_SECRET");
const TOKEN_ENCRYPTION_KEY = (0, params_1.defineSecret)("TOKEN_ENCRYPTION_KEY");
const accounts_1 = require("../../orchestrators/accounts");
const budgets_1 = require("../../orchestrators/budgets");
const assign_transaction_orchestrator_1 = require("../../orchestrators/transactions/assign_transaction.orchestrator");
const assign_transactions_batch_orchestrator_1 = require("../../orchestrators/transactions/assign_transactions_batch.orchestrator");
const assign_user_transactions_orchestrator_1 = require("../../orchestrators/transactions/assign_user_transactions.orchestrator");
const recompute_budget_spent_orchestrator_1 = require("../../orchestrators/budgets/recompute_budget_spent.orchestrator");
const recompute_budget_rollover_orchestrator_1 = require("../../orchestrators/budgets/recompute_budget_rollover.orchestrator");
const reassign_fanout_orchestrator_1 = require("../../orchestrators/transactions/reassign_fanout.orchestrator");
const classify_internal_transfers_orchestrator_1 = require("../../orchestrators/plaid/classify_internal_transfers.orchestrator");
const reassign_user_orchestrator_1 = require("../../orchestrators/transactions/reassign_user.orchestrator");
const backfill_assignments_orchestrator_1 = require("../../orchestrators/transactions/backfill_assignments.orchestrator");
const reconcile_recurring_periods_orchestrator_1 = require("../../orchestrators/recurring/reconcile_recurring_periods.orchestrator");
const backfill_recurring_reconciliation_orchestrator_1 = require("../../orchestrators/recurring/backfill_recurring_reconciliation.orchestrator");
const regenerate_recurring_occurrences_orchestrator_1 = require("../../orchestrators/recurring/regenerate_recurring_occurrences.orchestrator");
const assign_recurring_transactions_orchestrator_1 = require("../../orchestrators/recurring/assign_recurring_transactions.orchestrator");
const reconcile_user_recurring_orchestrator_1 = require("../../orchestrators/recurring/reconcile_user_recurring.orchestrator");
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
    // RETIRED: `update_user_summary` job handler removed — the user_summaries build is
    // disabled (enqueue chokepoint is a no-op, period triggers un-exported). Any orphaned
    // jobs already in the queue will fail as an unknown type, which is safe.
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
    // Debounced per-user assignment: re-assign the user's transactions changed since their watermark
    // via one batch (shared context + candidates resolved once) — the sync-path replacement for the
    // per-transaction assign fan-out. Enqueued by on_transaction_written.
    assign_user_transactions: async (ctx, payload) => {
        await (0, assign_user_transactions_orchestrator_1.assign_user_transactions_orchestrator)(ctx, payload);
    },
    // Spend pipeline: recompute budget_period.spent for the touched budgets
    recompute_budget_spent: async (ctx, payload) => {
        await (0, recompute_budget_spent_orchestrator_1.recompute_budget_spent_orchestrator)(ctx, payload);
    },
    // Rollover (real-time): recompute a budget's rollover chain after its spend changed
    recalculate_rollover: async (ctx, payload) => {
        await (0, recompute_budget_rollover_orchestrator_1.recompute_budget_rollover_orchestrator)(ctx, payload);
    },
    // One-shot backfill: re-assign + full-recompute (self-fans per user)
    backfill_assignments: async (ctx, payload) => {
        await (0, backfill_assignments_orchestrator_1.backfill_assignments_orchestrator)(ctx, payload);
    },
    reassign_user: async (ctx, payload) => {
        await (0, reassign_user_orchestrator_1.reassign_user_orchestrator)(ctx, payload);
    },
    classify_transfers: async (ctx, payload) => {
        const { user_id } = payload;
        await (0, classify_internal_transfers_orchestrator_1.classify_internal_transfers_orchestrator)(ctx, user_id, Date.now(), { force: true });
    },
    category_reassign_fanout: async (ctx) => {
        await (0, reassign_fanout_orchestrator_1.category_reassign_fanout_orchestrator)(ctx);
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
    // Debounced per-user recurring reconcile (TR-3): assigns + reconciles every recurring
    // updated since the user's watermark, collapsing the per-bill import fan-out.
    reconcile_user_recurring: async (ctx, payload) => {
        await (0, reconcile_user_recurring_orchestrator_1.reconcile_user_recurring_orchestrator)(ctx, payload);
    },
    // Full, permanent user erase (revokes Plaid tokens + hard-deletes all data).
    purge_user_data: async (ctx, payload) => {
        await (0, purge_user_data_orchestrator_1.purge_user_data_orchestrator)(ctx, payload);
    },
    // Delayed transaction re-sync for a freshly-linked item — Plaid's initial history
    // pull is ASYNC, so the sync at link time usually returns 0. Self-retries with an
    // escalating delay until transactions arrive (or ~4 attempts), so new items don't
    // depend on a timely SYNC_UPDATES_AVAILABLE webhook.
    resync_transactions: async (ctx, payload) => {
        // Legacy job (pre sync_item) — any still queued just run a normal item sync.
        const p = payload;
        await (0, sync_item_orchestrator_1.sync_item_orchestrator)(ctx, { item_doc_id: p.item_id, user_id: p.user_id, reason: "legacy_resync" });
    },
    // THE item sync (first link, webhooks, crons, retries): one writer per item (lease), every
    // transaction written once, one follow-up pass. See orchestrators/plaid/sync_item.
    sync_item: async (ctx, payload) => {
        await (0, sync_item_orchestrator_1.sync_item_orchestrator)(ctx, payload);
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
    // 1GiB: a first-link `sync_item` holds a few thousand transactions in memory. Each job runs in
    // its own instance (concurrency 1 below 1 vCPU), so 20 users linking at once = 20 instances.
    memory: "1GiB",
    timeoutSeconds: 540, // 9 min — headroom for IO-heavy batches under Firestore contention
    secrets: [PLAID_CLIENT_ID, PLAID_SECRET, TOKEN_ENCRYPTION_KEY],
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