"use strict";
/**
 * Outflow Period Summary Triggers
 *
 * Triggers that update user_summaries when outflow_periods change.
 * Uses the 5-layer architecture orchestrator for proper summary updates.
 *
 * IMPORTANT: The CREATE trigger has been REMOVED to prevent race conditions.
 * When outflow_periods are created in batch (e.g., new outflow generates ~95 periods),
 * the orchestrator handles summary updates AFTER all periods are saved.
 *
 * The UPDATE and DELETE triggers remain to handle individual period changes.
 *
 * @module summaries/triggers/outflowPeriodSummaryTriggers
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.on_outflow_period_deleted_summary = exports.on_outflow_period_updated_summary = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const trigger_processing_repository_1 = require("../../repositories/infrastructure/trigger_processing.repository");
const job_queue_1 = require("../../infrastructure/job_queue");
const uuid_1 = require("uuid");
/**
 * NOTE: on_outflow_period_created_summary has been REMOVED.
 *
 * Previously, this trigger fired for each outflow_period created, which caused
 * race conditions when many periods were created at once (batch outflow creation).
 *
 * The summary update for new periods is now handled by:
 * - generate_outflow_periods.orchestrator.ts calls enqueue_user_summary_updates_from_outflow_periods()
 * - This happens AFTER all periods are saved, ensuring complete data
 */
/**
 * Trigger: When an outflow_period is updated
 *
 * Recalculates the user_summaries document for this period to reflect changes.
 * Uses the 5-layer architecture orchestrator for proper updates.
 * Includes idempotency guard and debounce logic.
 */
exports.on_outflow_period_updated_summary = (0, firestore_1.onDocumentUpdated)({
    document: "outflow_periods/{outflowPeriodId}",
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
}, async (event) => {
    var _a;
    const doc_id = event.params.outflowPeriodId;
    // Create trace context early for idempotency check
    const trace_id = (0, uuid_1.v4)();
    const span_id = (0, uuid_1.v4)();
    const trace_ctx = { trace_id, span_id };
    // 1. IDEMPOTENCY GUARD - Check if this exact event was already processed
    const idempotency_key = `outflow_period_updated_summary:${doc_id}:${event.id}`;
    const already_processed = await (0, trigger_processing_repository_1.is_processed)(trace_ctx, idempotency_key);
    if (already_processed) {
        console.log(`[on_outflow_period_updated_summary] Skipping duplicate event: ${idempotency_key}`);
        return;
    }
    try {
        const after_data = (_a = event.data) === null || _a === void 0 ? void 0 : _a.after.data();
        if (!after_data) {
            console.error("[on_outflow_period_updated_summary] No after data found");
            return;
        }
        // Guard: Skip if ownerId is missing
        if (!after_data.ownerId) {
            console.error(`[on_outflow_period_updated_summary] CRITICAL: ownerId is missing! Document: ${doc_id}`);
            return;
        }
        // Build summary ID for deduplication
        const normalized_period_type = after_data.periodType.toLowerCase();
        const summary_id = `${after_data.ownerId}_${normalized_period_type}_${after_data.sourcePeriodId}`;
        console.log("[on_outflow_period_updated_summary] Enqueueing user summary update job");
        console.log(`  - Document: ${doc_id}`);
        console.log(`  - Summary ID: ${summary_id}`);
        // 2. ENQUEUE JOB (with deduplication)
        // The job queue will serialize updates and prevent race conditions
        const job = await (0, job_queue_1.create_job_if_not_exists)("update_user_summary", {
            user_id: after_data.ownerId,
            period_type: after_data.periodType,
            source_period_id: after_data.sourcePeriodId,
            deduplication_key: summary_id,
        }, {
            trace_id,
            // No delay - job is processed immediately by on_job_created trigger
            // Deduplication prevents duplicates while a job is active
        });
        if (job) {
            console.log(`[on_outflow_period_updated_summary] Enqueued job ${job.job_id} for summary ${summary_id}`);
        }
        else {
            console.log(`[on_outflow_period_updated_summary] Job already pending for summary ${summary_id}`);
        }
        // 3. MARK AS PROCESSED
        await (0, trigger_processing_repository_1.mark_processed)(trace_ctx, idempotency_key, doc_id, event.id);
    }
    catch (error) {
        console.error("[on_outflow_period_updated_summary] Error enqueueing job:", error);
        // Don't throw - summary updates should not break period updates
        // Don't mark as processed - allow retry on error
    }
});
/**
 * Trigger: When an outflow_period is deleted
 *
 * Recalculates the user_summaries document to remove the deleted period entry.
 * Uses the 5-layer architecture orchestrator for proper updates.
 * Includes idempotency guard and debounce logic.
 */
exports.on_outflow_period_deleted_summary = (0, firestore_1.onDocumentDeleted)({
    document: "outflow_periods/{outflowPeriodId}",
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
}, async (event) => {
    var _a;
    const doc_id = event.params.outflowPeriodId;
    // Create trace context early for idempotency check
    const trace_id = (0, uuid_1.v4)();
    const span_id = (0, uuid_1.v4)();
    const trace_ctx = { trace_id, span_id };
    // 1. IDEMPOTENCY GUARD - Check if this exact event was already processed
    const idempotency_key = `outflow_period_deleted_summary:${doc_id}:${event.id}`;
    const already_processed = await (0, trigger_processing_repository_1.is_processed)(trace_ctx, idempotency_key);
    if (already_processed) {
        console.log(`[on_outflow_period_deleted_summary] Skipping duplicate event: ${idempotency_key}`);
        return;
    }
    try {
        const deleted_data = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
        if (!deleted_data) {
            console.error("[on_outflow_period_deleted_summary] No deleted data found");
            return;
        }
        // Guard: Skip if ownerId is missing
        if (!deleted_data.ownerId) {
            console.error(`[on_outflow_period_deleted_summary] CRITICAL: ownerId is missing! Document: ${doc_id}`);
            return;
        }
        // Build summary ID for deduplication
        const normalized_period_type = deleted_data.periodType.toLowerCase();
        const summary_id = `${deleted_data.ownerId}_${normalized_period_type}_${deleted_data.sourcePeriodId}`;
        console.log("[on_outflow_period_deleted_summary] Enqueueing user summary update job after deletion");
        console.log(`  - Document: ${doc_id}`);
        console.log(`  - Summary ID: ${summary_id}`);
        // 2. ENQUEUE JOB (with deduplication)
        // The job queue will serialize updates and prevent race conditions
        const job = await (0, job_queue_1.create_job_if_not_exists)("update_user_summary", {
            user_id: deleted_data.ownerId,
            period_type: deleted_data.periodType,
            source_period_id: deleted_data.sourcePeriodId,
            deduplication_key: summary_id,
        }, {
            trace_id,
            // No delay - job is processed immediately by on_job_created trigger
            // Deduplication prevents duplicates while a job is active
        });
        if (job) {
            console.log(`[on_outflow_period_deleted_summary] Enqueued job ${job.job_id} for summary ${summary_id}`);
        }
        else {
            console.log(`[on_outflow_period_deleted_summary] Job already pending for summary ${summary_id}`);
        }
        // 3. MARK AS PROCESSED
        await (0, trigger_processing_repository_1.mark_processed)(trace_ctx, idempotency_key, doc_id, event.id);
    }
    catch (error) {
        console.error("[on_outflow_period_deleted_summary] Error enqueueing job:", error);
        // Don't throw - summary updates should not break period deletion
        // Don't mark as processed - allow retry on error
    }
});
//# sourceMappingURL=outflowPeriodSummaryTriggers.js.map