/**
 * Job Created Trigger
 *
 * Processes jobs immediately when they are created in the _jobs collection.
 * This provides near-instant processing while the scheduled function serves
 * as a fallback for retries and any missed jobs.
 *
 * @module entry/triggers/on_job_created
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import {
  claim_job,
  mark_job_completed,
  mark_job_failed,
  Job,
} from "../../infrastructure/job_queue";
import {
  cascade_hide_transactions_orchestrator,
  CascadeHideTransactionsInput,
  cascade_soft_delete_recurring_orchestrator,
  CascadeSoftDeleteRecurringInput,
  restore_account_transactions_orchestrator,
  RestoreAccountTransactionsInput,
  restore_account_recurring_orchestrator,
  RestoreAccountRecurringInput,
} from "../../orchestrators/accounts";
import {
  update_user_summary_orchestrator,
  UpdateUserSummaryInput,
} from "../../orchestrators/summaries";
import {
  process_budget_created_orchestrator,
  process_budget_updated_orchestrator,
  process_budget_deleted_orchestrator,
} from "../../orchestrators/budgets";
import {
  ProcessBudgetCreatedPayload,
} from "../../types/budgets/create_budget.types";
import {
  ProcessBudgetUpdatedPayload,
} from "../../types/budgets/update_budget.types";
import {
  ProcessBudgetDeletedPayload,
} from "../../types/budgets/delete_budget.types";

/**
 * Job type handlers - same as in process_job_queue.scheduled.ts
 */
type JobHandler<T> = (ctx: { trace_id: string; span_id: string }, payload: T) => Promise<void>;

const JOB_HANDLERS: Record<string, JobHandler<unknown>> = {
  // Account removal cascade jobs
  cascade_hide_transactions: async (ctx, payload) => {
    const input = payload as CascadeHideTransactionsInput;
    await cascade_hide_transactions_orchestrator(ctx, input);
  },

  cascade_soft_delete_recurring: async (ctx, payload) => {
    const input = payload as CascadeSoftDeleteRecurringInput;
    await cascade_soft_delete_recurring_orchestrator(ctx, input);
  },

  // Account restore jobs
  restore_account_transactions: async (ctx, payload) => {
    const input = payload as RestoreAccountTransactionsInput;
    await restore_account_transactions_orchestrator(ctx, input);
  },

  restore_account_recurring: async (ctx, payload) => {
    const input = payload as RestoreAccountRecurringInput;
    await restore_account_recurring_orchestrator(ctx, input);
  },

  // User summary update job
  update_user_summary: async (ctx, payload) => {
    const input = payload as UpdateUserSummaryInput & { deduplication_key: string };
    await update_user_summary_orchestrator({
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
    await process_budget_created_orchestrator(
      ctx,
      payload as ProcessBudgetCreatedPayload
    );
  },

  process_budget_updated: async (ctx, payload) => {
    await process_budget_updated_orchestrator(
      ctx,
      payload as ProcessBudgetUpdatedPayload
    );
  },

  process_budget_deleted: async (ctx, payload) => {
    await process_budget_deleted_orchestrator(
      ctx,
      payload as ProcessBudgetDeletedPayload
    );
  },
};

/**
 * Trigger: Process job immediately when created
 *
 * This trigger fires when a new job is added to the _jobs collection.
 * It attempts to claim and process the job immediately, providing
 * near-instant execution instead of waiting for the scheduled function.
 */
export const on_job_created = onDocumentCreated(
  {
    document: "_jobs/{jobId}",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 300, // 5 minutes max for job processing
  },
  async (event) => {
    const job_id = event.params.jobId;
    const job_data = event.data?.data() as Job | undefined;

    if (!job_data) {
      console.error(`[on_job_created] No job data found for ${job_id}`);
      return;
    }

    // Skip if job is scheduled for the future
    if (job_data.scheduled_for && job_data.scheduled_for.toMillis() > Date.now()) {
      console.log(
        `[on_job_created] Job ${job_id} scheduled for future, skipping immediate processing`
      );
      return;
    }

    console.log(
      `[on_job_created] Processing job ${job_id} of type ${job_data.job_type}`
    );

    try {
      // Claim the job atomically (prevents duplicate processing)
      const claimed_job = await claim_job(job_id);

      if (!claimed_job) {
        console.log(
          `[on_job_created] Job ${job_id} already claimed or not pending, skipping`
        );
        return;
      }

      // Find the handler
      const handler = JOB_HANDLERS[job_data.job_type];

      if (!handler) {
        console.error(
          `[on_job_created] Unknown job type: ${job_data.job_type}`
        );
        await mark_job_failed(job_id, `Unknown job type: ${job_data.job_type}`);
        return;
      }

      // Execute the handler
      const job_ctx = {
        trace_id: job_data.trace_id || job_id,
        span_id: job_id,
      };

      await handler(job_ctx, claimed_job.payload);

      // Mark as completed
      await mark_job_completed(job_id);

      console.log(
        `[on_job_created] Job ${job_id} completed successfully`
      );
    } catch (error) {
      console.error(
        `[on_job_created] Job ${job_id} failed:`,
        error
      );

      const error_message = error instanceof Error
        ? error.message
        : "Unknown error";

      const will_retry = await mark_job_failed(job_id, error_message);

      if (will_retry) {
        console.log(
          `[on_job_created] Job ${job_id} scheduled for retry (will be picked up by scheduled function)`
        );
      } else {
        console.log(
          `[on_job_created] Job ${job_id} moved to DLQ`
        );
      }
    }
  }
);
