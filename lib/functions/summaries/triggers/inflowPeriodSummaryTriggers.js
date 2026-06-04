"use strict";
/**
 * Inflow Period Summary Triggers
 *
 * Triggers that update user_summaries when inflow_periods change.
 * Uses the 5-layer architecture orchestrator for proper summary updates.
 *
 * IMPORTANT: The CREATE trigger has been REMOVED to prevent race conditions.
 * When inflow_periods are created in batch (e.g., new inflow generates ~50 periods),
 * the orchestrator or batch operation should handle summary updates AFTER all periods are saved.
 *
 * The UPDATE and DELETE triggers remain to handle individual period changes.
 *
 * @module summaries/triggers/inflowPeriodSummaryTriggers
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.on_inflow_period_deleted_period_summary = exports.on_inflow_period_updated_period_summary = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const trigger_processing_repository_1 = require("../../repositories/infrastructure/trigger_processing.repository");
const job_queue_1 = require("../../infrastructure/job_queue");
const uuid_1 = require("uuid");
/**
 * NOTE: on_inflow_period_created_period_summary has been REMOVED.
 *
 * Previously, this trigger fired for each inflow_period created, which caused
 * race conditions when many periods were created at once (batch inflow creation).
 *
 * The summary update for new periods should be handled by:
 * - The inflow creation orchestrator calling enqueue_user_summary_updates_from_inflow_periods()
 * - This happens AFTER all periods are saved, ensuring complete data
 */
/**
 * Trigger: Update user period summary when an inflow period is updated
 *
 * When an inflow_period is updated, this trigger recalculates the
 * user period summary for the corresponding period.
 *
 * Uses the 5-layer architecture orchestrator for proper updates.
 * Includes idempotency guard and debounce logic.
 */
exports.on_inflow_period_updated_period_summary = (0, firestore_1.onDocumentUpdated)({
    document: "inflow_periods/{inflowPeriodId}",
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
}, async (event) => {
    var _a;
    const doc_id = event.params.inflowPeriodId;
    // Create trace context early for idempotency check
    const trace_id = (0, uuid_1.v4)();
    const span_id = (0, uuid_1.v4)();
    const trace_ctx = { trace_id, span_id };
    // 1. IDEMPOTENCY GUARD - Check if this exact event was already processed
    const idempotency_key = `inflow_period_updated_summary:${doc_id}:${event.id}`;
    const already_processed = await (0, trigger_processing_repository_1.is_processed)(trace_ctx, idempotency_key);
    if (already_processed) {
        console.log(`[on_inflow_period_updated_period_summary] Skipping duplicate event: ${idempotency_key}`);
        return;
    }
    try {
        const inflow_period = (_a = event.data) === null || _a === void 0 ? void 0 : _a.after.data();
        if (!inflow_period) {
            console.error("[on_inflow_period_updated_period_summary] No inflow period data");
            return;
        }
        // Guard: Skip if ownerId is missing
        if (!inflow_period.ownerId) {
            console.error(`[on_inflow_period_updated_period_summary] CRITICAL: ownerId is missing! Document: ${doc_id}`);
            return;
        }
        // Build summary ID for deduplication
        const normalized_period_type = String(inflow_period.periodType).toLowerCase();
        const summary_id = `${inflow_period.ownerId}_${normalized_period_type}_${inflow_period.sourcePeriodId}`;
        console.log("[on_inflow_period_updated_period_summary] Enqueueing user summary update job");
        console.log(`  - Document: ${doc_id}`);
        console.log(`  - Summary ID: ${summary_id}`);
        // 2. ENQUEUE JOB (with deduplication)
        // The job queue will serialize updates and prevent race conditions
        const job = await (0, job_queue_1.create_job_if_not_exists)("update_user_summary", {
            user_id: inflow_period.ownerId,
            period_type: String(inflow_period.periodType),
            source_period_id: inflow_period.sourcePeriodId,
            deduplication_key: summary_id,
        }, {
            trace_id,
            // No delay - job is processed immediately by on_job_created trigger
            // Deduplication prevents duplicates while a job is active
        });
        if (job) {
            console.log(`[on_inflow_period_updated_period_summary] Enqueued job ${job.job_id} for summary ${summary_id}`);
        }
        else {
            console.log(`[on_inflow_period_updated_period_summary] Job already pending for summary ${summary_id}`);
        }
        // 3. MARK AS PROCESSED
        await (0, trigger_processing_repository_1.mark_processed)(trace_ctx, idempotency_key, doc_id, event.id);
    }
    catch (error) {
        console.error("[on_inflow_period_updated_period_summary] Error enqueueing job:", error);
        // Don't throw - summary updates should not break period updates
        // Don't mark as processed - allow retry on error
    }
});
/**
 * Trigger: Update user period summary when an inflow period is deleted
 *
 * When an inflow_period is deleted, this trigger recalculates the
 * user period summary for the corresponding period.
 *
 * Uses the 5-layer architecture orchestrator for proper updates.
 * Includes idempotency guard and debounce logic.
 */
exports.on_inflow_period_deleted_period_summary = (0, firestore_1.onDocumentDeleted)({
    document: "inflow_periods/{inflowPeriodId}",
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
}, async (event) => {
    var _a;
    const doc_id = event.params.inflowPeriodId;
    // Create trace context early for idempotency check
    const trace_id = (0, uuid_1.v4)();
    const span_id = (0, uuid_1.v4)();
    const trace_ctx = { trace_id, span_id };
    // 1. IDEMPOTENCY GUARD - Check if this exact event was already processed
    const idempotency_key = `inflow_period_deleted_summary:${doc_id}:${event.id}`;
    const already_processed = await (0, trigger_processing_repository_1.is_processed)(trace_ctx, idempotency_key);
    if (already_processed) {
        console.log(`[on_inflow_period_deleted_period_summary] Skipping duplicate event: ${idempotency_key}`);
        return;
    }
    try {
        const inflow_period = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
        if (!inflow_period) {
            console.error("[on_inflow_period_deleted_period_summary] No inflow period data");
            return;
        }
        // Guard: Skip if ownerId is missing
        if (!inflow_period.ownerId) {
            console.error(`[on_inflow_period_deleted_period_summary] CRITICAL: ownerId is missing! Document: ${doc_id}`);
            return;
        }
        // Build summary ID for deduplication
        const normalized_period_type = String(inflow_period.periodType).toLowerCase();
        const summary_id = `${inflow_period.ownerId}_${normalized_period_type}_${inflow_period.sourcePeriodId}`;
        console.log("[on_inflow_period_deleted_period_summary] Enqueueing user summary update job after deletion");
        console.log(`  - Document: ${doc_id}`);
        console.log(`  - Summary ID: ${summary_id}`);
        // 2. ENQUEUE JOB (with deduplication)
        // The job queue will serialize updates and prevent race conditions
        const job = await (0, job_queue_1.create_job_if_not_exists)("update_user_summary", {
            user_id: inflow_period.ownerId,
            period_type: String(inflow_period.periodType),
            source_period_id: inflow_period.sourcePeriodId,
            deduplication_key: summary_id,
        }, {
            trace_id,
            // No delay - job is processed immediately by on_job_created trigger
            // Deduplication prevents duplicates while a job is active
        });
        if (job) {
            console.log(`[on_inflow_period_deleted_period_summary] Enqueued job ${job.job_id} for summary ${summary_id}`);
        }
        else {
            console.log(`[on_inflow_period_deleted_period_summary] Job already pending for summary ${summary_id}`);
        }
        // 3. MARK AS PROCESSED
        await (0, trigger_processing_repository_1.mark_processed)(trace_ctx, idempotency_key, doc_id, event.id);
    }
    catch (error) {
        console.error("[on_inflow_period_deleted_period_summary] Error enqueueing job:", error);
        // Don't throw - summary updates should not break period deletion
        // Don't mark as processed - allow retry on error
    }
});
//# sourceMappingURL=inflowPeriodSummaryTriggers.js.map