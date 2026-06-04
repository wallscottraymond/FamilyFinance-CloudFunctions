"use strict";
/**
 * Restore Account Recurring Orchestrator
 *
 * Job handler that restores soft-deleted recurring items for a restored account.
 * Sets `isActive: true` on outflows and inflows linked to the account.
 *
 * @module orchestrators/accounts/restore_account_recurring
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.restore_account_recurring_orchestrator = restore_account_recurring_orchestrator;
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const repositories_1 = require("../../repositories");
const firestore_1 = require("firebase-admin/firestore");
/**
 * Performance budget for restore_account_recurring job.
 */
const _BUDGET = {
    max_reads: 20,
    max_writes: 100,
    max_time_ms: 10000,
};
void _BUDGET; // Reserved for future budget checking
/**
 * Batch size for updates.
 */
const BATCH_SIZE = 100;
/**
 * Orchestrates restoring recurring items for a restored account.
 *
 * This is a job handler - called by the job queue processor.
 *
 * Flow:
 * 1. Get soft-deleted outflows for the account
 * 2. Get soft-deleted inflows for the account
 * 3. Batch update to restore them (isActive: true)
 *
 * @param ctx - Trace context (from job payload)
 * @param input - Job input
 * @returns Restore result
 */
async function restore_account_recurring_orchestrator(ctx, input) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "restore_account_recurring");
    const perf = (0, types_1.create_performance_metrics)();
    (0, observability_1.log_operation_start)(span, input.user_id);
    try {
        const db = (0, firestore_1.getFirestore)();
        let outflows_restored = 0;
        let inflows_restored = 0;
        // 1. Get soft-deleted outflows for this account
        const outflows = await repositories_1.outflow_repo.get_by_account_id(ctx, input.plaid_account_id, { include_deleted: true });
        perf.reads++;
        // Filter to only inactive (soft-deleted) outflows
        const deleted_outflows = outflows.filter(o => !o.is_active);
        if (deleted_outflows.length > 0) {
            console.log(`[${ctx.trace_id}] Restoring ${deleted_outflows.length} outflows for account ${input.plaid_account_id}`);
            // Batch restore outflows
            for (let i = 0; i < deleted_outflows.length; i += BATCH_SIZE) {
                const batch_items = deleted_outflows.slice(i, i + BATCH_SIZE);
                const batch = db.batch();
                for (const outflow of batch_items) {
                    const doc_ref = db.collection("outflows").doc(outflow.id);
                    batch.update(doc_ref, {
                        isActive: true,
                        restoredAt: firestore_1.Timestamp.now(),
                    });
                }
                await batch.commit();
                outflows_restored += batch_items.length;
                perf.writes++;
            }
        }
        // 2. Get soft-deleted inflows for this account
        const inflows = await repositories_1.inflow_repo.get_by_account_id(ctx, input.plaid_account_id, { include_deleted: true });
        perf.reads++;
        // Filter to only inactive (soft-deleted) inflows
        const deleted_inflows = inflows.filter(i => !i.is_active);
        if (deleted_inflows.length > 0) {
            console.log(`[${ctx.trace_id}] Restoring ${deleted_inflows.length} inflows for account ${input.plaid_account_id}`);
            // Batch restore inflows
            for (let i = 0; i < deleted_inflows.length; i += BATCH_SIZE) {
                const batch_items = deleted_inflows.slice(i, i + BATCH_SIZE);
                const batch = db.batch();
                for (const inflow of batch_items) {
                    const doc_ref = db.collection("inflows").doc(inflow.id);
                    batch.update(doc_ref, {
                        isActive: true,
                        restoredAt: firestore_1.Timestamp.now(),
                    });
                }
                await batch.commit();
                inflows_restored += batch_items.length;
                perf.writes++;
            }
        }
        (0, observability_1.log_operation_success)(span, input.user_id);
        // 3. Async debug logging
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: "orchestrator",
            function: "restore_account_recurring",
            status: "success",
            context: {
                account_id: input.plaid_account_id,
                outflows_restored,
                inflows_restored,
                perf_reads: perf.reads,
                perf_writes: perf.writes,
            },
        }));
        console.log(`[${ctx.trace_id}] restore_account_recurring: ` +
            `account=${input.plaid_account_id}, ` +
            `outflows=${outflows_restored}, inflows=${inflows_restored}`);
        return {
            success: true,
            outflows_restored,
            inflows_restored,
        };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: input.user_id, error_code: "RESTORE_RECURRING_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=restore_account_recurring.orchestrator.js.map