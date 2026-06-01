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

import { onDocumentUpdated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { OutflowPeriod } from "../../../types";
import {
  is_processed,
  mark_processed,
} from "../../repositories/infrastructure/trigger_processing.repository";
import { create_job_if_not_exists } from "../../infrastructure/job_queue";
import { v4 as uuid } from "uuid";

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
export const on_outflow_period_updated_summary = onDocumentUpdated(
  {
    document: "outflow_periods/{outflowPeriodId}",
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
  },
  async (event) => {
    const doc_id = event.params.outflowPeriodId;

    // Create trace context early for idempotency check
    const trace_id = uuid();
    const span_id = uuid();
    const trace_ctx = { trace_id, span_id };

    // 1. IDEMPOTENCY GUARD - Check if this exact event was already processed
    const idempotency_key = `outflow_period_updated_summary:${doc_id}:${event.id}`;
    const already_processed = await is_processed(trace_ctx, idempotency_key);

    if (already_processed) {
      console.log(
        `[on_outflow_period_updated_summary] Skipping duplicate event: ${idempotency_key}`
      );
      return;
    }

    try {
      const after_data = event.data?.after.data() as OutflowPeriod;

      if (!after_data) {
        console.error("[on_outflow_period_updated_summary] No after data found");
        return;
      }

      // Guard: Skip if ownerId is missing
      if (!after_data.ownerId) {
        console.error(
          `[on_outflow_period_updated_summary] CRITICAL: ownerId is missing! Document: ${doc_id}`
        );
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
      const job = await create_job_if_not_exists(
        "update_user_summary",
        {
          user_id: after_data.ownerId,
          period_type: after_data.periodType,
          source_period_id: after_data.sourcePeriodId,
          deduplication_key: summary_id,
        },
        {
          trace_id,
          // No delay - job is processed immediately by on_job_created trigger
          // Deduplication prevents duplicates while a job is active
        }
      );

      if (job) {
        console.log(
          `[on_outflow_period_updated_summary] Enqueued job ${job.job_id} for summary ${summary_id}`
        );
      } else {
        console.log(
          `[on_outflow_period_updated_summary] Job already pending for summary ${summary_id}`
        );
      }

      // 3. MARK AS PROCESSED
      await mark_processed(trace_ctx, idempotency_key, doc_id, event.id);
    } catch (error) {
      console.error("[on_outflow_period_updated_summary] Error enqueueing job:", error);
      // Don't throw - summary updates should not break period updates
      // Don't mark as processed - allow retry on error
    }
  }
);

/**
 * Trigger: When an outflow_period is deleted
 *
 * Recalculates the user_summaries document to remove the deleted period entry.
 * Uses the 5-layer architecture orchestrator for proper updates.
 * Includes idempotency guard and debounce logic.
 */
export const on_outflow_period_deleted_summary = onDocumentDeleted(
  {
    document: "outflow_periods/{outflowPeriodId}",
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
  },
  async (event) => {
    const doc_id = event.params.outflowPeriodId;

    // Create trace context early for idempotency check
    const trace_id = uuid();
    const span_id = uuid();
    const trace_ctx = { trace_id, span_id };

    // 1. IDEMPOTENCY GUARD - Check if this exact event was already processed
    const idempotency_key = `outflow_period_deleted_summary:${doc_id}:${event.id}`;
    const already_processed = await is_processed(trace_ctx, idempotency_key);

    if (already_processed) {
      console.log(
        `[on_outflow_period_deleted_summary] Skipping duplicate event: ${idempotency_key}`
      );
      return;
    }

    try {
      const deleted_data = event.data?.data() as OutflowPeriod;

      if (!deleted_data) {
        console.error("[on_outflow_period_deleted_summary] No deleted data found");
        return;
      }

      // Guard: Skip if ownerId is missing
      if (!deleted_data.ownerId) {
        console.error(
          `[on_outflow_period_deleted_summary] CRITICAL: ownerId is missing! Document: ${doc_id}`
        );
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
      const job = await create_job_if_not_exists(
        "update_user_summary",
        {
          user_id: deleted_data.ownerId,
          period_type: deleted_data.periodType,
          source_period_id: deleted_data.sourcePeriodId,
          deduplication_key: summary_id,
        },
        {
          trace_id,
          // No delay - job is processed immediately by on_job_created trigger
          // Deduplication prevents duplicates while a job is active
        }
      );

      if (job) {
        console.log(
          `[on_outflow_period_deleted_summary] Enqueued job ${job.job_id} for summary ${summary_id}`
        );
      } else {
        console.log(
          `[on_outflow_period_deleted_summary] Job already pending for summary ${summary_id}`
        );
      }

      // 3. MARK AS PROCESSED
      await mark_processed(trace_ctx, idempotency_key, doc_id, event.id);
    } catch (error) {
      console.error("[on_outflow_period_deleted_summary] Error enqueueing job:", error);
      // Don't throw - summary updates should not break period deletion
      // Don't mark as processed - allow retry on error
    }
  }
);
