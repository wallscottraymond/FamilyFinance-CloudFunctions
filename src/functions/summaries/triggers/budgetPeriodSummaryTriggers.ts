/**
 * Budget Period Summary Triggers
 *
 * Triggers that update user_summaries when budget_periods change.
 * Uses the 5-layer architecture orchestrator for proper summary updates.
 *
 * IMPORTANT: The CREATE trigger has been REMOVED to prevent race conditions.
 * When budget_periods are created in batch (e.g., new budget generates ~78 periods),
 * the orchestrator or batch operation should handle summary updates AFTER all periods are saved.
 *
 * The UPDATE and DELETE triggers remain to handle individual period changes.
 *
 * @module summaries/triggers/budgetPeriodSummaryTriggers
 */

import { onDocumentUpdated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { BudgetPeriodDocument } from "../../../types";
import {
  is_processed,
  mark_processed,
} from "../../repositories/infrastructure/trigger_processing.repository";
import { create_job_if_not_exists } from "../../infrastructure/job_queue";
import { v4 as uuid } from "uuid";

/**
 * NOTE: on_budget_period_created_period_summary has been REMOVED.
 *
 * Previously, this trigger fired for each budget_period created, which caused
 * race conditions when many periods were created at once (batch budget creation).
 *
 * The summary update for new periods should be handled by:
 * - The budget creation orchestrator calling enqueue_user_summary_updates_from_budget_periods()
 * - This happens AFTER all periods are saved, ensuring complete data
 */

/**
 * Trigger: Update user period summary when a budget period is updated
 *
 * When a budget_period is updated, this trigger recalculates the
 * user period summary for the corresponding period.
 *
 * Uses the 5-layer architecture orchestrator for proper updates.
 * Includes idempotency guard and debounce logic.
 */
export const on_budget_period_updated_period_summary = onDocumentUpdated(
  {
    document: "budget_periods/{budgetPeriodId}",
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
  },
  async (event) => {
    const doc_id = event.params.budgetPeriodId;

    // Create trace context early for idempotency check
    const trace_id = uuid();
    const span_id = uuid();
    const trace_ctx = { trace_id, span_id };

    // 1. IDEMPOTENCY GUARD - Check if this exact event was already processed
    const idempotency_key = `budget_period_updated_summary:${doc_id}:${event.id}`;
    const already_processed = await is_processed(trace_ctx, idempotency_key);

    if (already_processed) {
      console.log(
        `[on_budget_period_updated_period_summary] Skipping duplicate event: ${idempotency_key}`
      );
      return;
    }

    try {
      const budget_period = event.data?.after.data() as BudgetPeriodDocument;

      if (!budget_period) {
        console.error("[on_budget_period_updated_period_summary] No budget period data");
        return;
      }

      // Guard: Skip if userId is missing
      if (!budget_period.userId) {
        console.error(
          `[on_budget_period_updated_period_summary] CRITICAL: userId is missing! Document: ${doc_id}`
        );
        return;
      }

      // Build summary ID for deduplication
      const normalized_period_type = String(budget_period.periodType).toLowerCase();
      const summary_id = `${budget_period.userId}_${normalized_period_type}_${budget_period.sourcePeriodId}`;

      console.log("[on_budget_period_updated_period_summary] Enqueueing user summary update job");
      console.log(`  - Document: ${doc_id}`);
      console.log(`  - Summary ID: ${summary_id}`);

      // 2. ENQUEUE JOB (with deduplication)
      // The job queue will serialize updates and prevent race conditions
      const job = await create_job_if_not_exists(
        "update_user_summary",
        {
          user_id: budget_period.userId,
          period_type: String(budget_period.periodType),
          source_period_id: budget_period.sourcePeriodId,
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
          `[on_budget_period_updated_period_summary] Enqueued job ${job.job_id} for summary ${summary_id}`
        );
      } else {
        console.log(
          `[on_budget_period_updated_period_summary] Job already pending for summary ${summary_id}`
        );
      }

      // 3. MARK AS PROCESSED
      await mark_processed(trace_ctx, idempotency_key, doc_id, event.id);
    } catch (error) {
      console.error("[on_budget_period_updated_period_summary] Error enqueueing job:", error);
      // Don't throw - summary updates should not break period updates
      // Don't mark as processed - allow retry on error
    }
  }
);

/**
 * Trigger: Update user period summary when a budget period is deleted
 *
 * When a budget_period is deleted, this trigger recalculates the
 * user period summary for the corresponding period.
 *
 * Uses the 5-layer architecture orchestrator for proper updates.
 * Includes idempotency guard and debounce logic.
 */
export const on_budget_period_deleted_period_summary = onDocumentDeleted(
  {
    document: "budget_periods/{budgetPeriodId}",
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
  },
  async (event) => {
    const doc_id = event.params.budgetPeriodId;

    // Create trace context early for idempotency check
    const trace_id = uuid();
    const span_id = uuid();
    const trace_ctx = { trace_id, span_id };

    // 1. IDEMPOTENCY GUARD - Check if this exact event was already processed
    const idempotency_key = `budget_period_deleted_summary:${doc_id}:${event.id}`;
    const already_processed = await is_processed(trace_ctx, idempotency_key);

    if (already_processed) {
      console.log(
        `[on_budget_period_deleted_period_summary] Skipping duplicate event: ${idempotency_key}`
      );
      return;
    }

    try {
      const budget_period = event.data?.data() as BudgetPeriodDocument;

      if (!budget_period) {
        console.error("[on_budget_period_deleted_period_summary] No budget period data");
        return;
      }

      // Guard: Skip if userId is missing
      if (!budget_period.userId) {
        console.error(
          `[on_budget_period_deleted_period_summary] CRITICAL: userId is missing! Document: ${doc_id}`
        );
        return;
      }

      // Build summary ID for deduplication
      const normalized_period_type = String(budget_period.periodType).toLowerCase();
      const summary_id = `${budget_period.userId}_${normalized_period_type}_${budget_period.sourcePeriodId}`;

      console.log("[on_budget_period_deleted_period_summary] Enqueueing user summary update job after deletion");
      console.log(`  - Document: ${doc_id}`);
      console.log(`  - Summary ID: ${summary_id}`);

      // 2. ENQUEUE JOB (with deduplication)
      // The job queue will serialize updates and prevent race conditions
      const job = await create_job_if_not_exists(
        "update_user_summary",
        {
          user_id: budget_period.userId,
          period_type: String(budget_period.periodType),
          source_period_id: budget_period.sourcePeriodId,
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
          `[on_budget_period_deleted_period_summary] Enqueued job ${job.job_id} for summary ${summary_id}`
        );
      } else {
        console.log(
          `[on_budget_period_deleted_period_summary] Job already pending for summary ${summary_id}`
        );
      }

      // 3. MARK AS PROCESSED
      await mark_processed(trace_ctx, idempotency_key, doc_id, event.id);
    } catch (error) {
      console.error("[on_budget_period_deleted_period_summary] Error enqueueing job:", error);
      // Don't throw - summary updates should not break period deletion
      // Don't mark as processed - allow retry on error
    }
  }
);
