/**
 * Process Job Queue Scheduled Function
 *
 * Runs periodically to process pending jobs in the queue.
 * Handles cascade operations for account removal and other async work.
 *
 * @module entry/scheduled/process_job_queue
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  get_pending_jobs,
  claim_job,
  mark_job_completed,
  mark_job_failed,
  Job,
} from "../../infrastructure/job_queue";
import {
  create_trace_context,
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
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
import { ProcessBudgetCreatedPayload } from "../../types/budgets/create_budget.types";
import { ProcessBudgetUpdatedPayload } from "../../types/budgets/update_budget.types";
import { ProcessBudgetDeletedPayload } from "../../types/budgets/delete_budget.types";
import {
  assign_transaction_orchestrator,
  AssignTransactionInput,
} from "../../orchestrators/transactions/assign_transaction.orchestrator";
import {
  recompute_budget_spent_orchestrator,
  RecomputeBudgetSpentInput,
} from "../../orchestrators/budgets/recompute_budget_spent.orchestrator";
import {
  backfill_assignments_orchestrator,
  BackfillAssignmentsInput,
} from "../../orchestrators/transactions/backfill_assignments.orchestrator";

/**
 * Maximum jobs to process per invocation.
 */
const MAX_JOBS_PER_RUN = 10;

/**
 * Job type handlers.
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
  // This serializes summary updates to prevent race conditions when multiple
  // triggers fire simultaneously for the same user summary
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

  // Transaction Assignment Engine + spend pipeline + backfill. Registered here
  // (not just in on_job_created) so a retried/missed engine job is processed by
  // the fallback worker instead of dead-lettering.
  assign_transaction: async (ctx, payload) => {
    await assign_transaction_orchestrator(ctx, payload as AssignTransactionInput);
  },

  recompute_budget_spent: async (ctx, payload) => {
    await recompute_budget_spent_orchestrator(ctx, payload as RecomputeBudgetSpentInput);
  },

  backfill_assignments: async (ctx, payload) => {
    await backfill_assignments_orchestrator(ctx, payload as BackfillAssignmentsInput);
  },
};

/**
 * Scheduled function to process the job queue.
 *
 * Runs every minute to check for pending jobs.
 * Claims jobs atomically to prevent duplicate processing.
 */
export const process_job_queue = onSchedule(
  {
    schedule: "every 1 minutes",
    timeoutSeconds: 540, // 9 minutes
    memory: "512MiB",
  },
  async () => {
    const ctx = create_trace_context(false);
    const span = create_span(ctx, "entry", "process_job_queue");
    log_operation_start(span, "system");

    let processed = 0;
    let failed = 0;

    try {
      // Get pending jobs
      const pending_jobs = await get_pending_jobs(undefined, MAX_JOBS_PER_RUN);

      if (pending_jobs.length === 0) {
        console.log(`[${ctx.trace_id}] No pending jobs to process`);
        return;
      }

      console.log(
        `[${ctx.trace_id}] Found ${pending_jobs.length} pending jobs to process`
      );

      // Process each job
      for (const job of pending_jobs) {
        try {
          // Claim the job atomically
          const claimed_job = await claim_job(job.job_id);

          if (!claimed_job) {
            console.log(
              `[${ctx.trace_id}] Job ${job.job_id} already claimed, skipping`
            );
            continue;
          }

          console.log(
            `[${ctx.trace_id}] Processing job ${job.job_id} of type ${job.job_type}`
          );

          // Find the handler
          const handler = JOB_HANDLERS[job.job_type];

          if (!handler) {
            console.error(
              `[${ctx.trace_id}] Unknown job type: ${job.job_type}`
            );
            await mark_job_failed(job.job_id, `Unknown job type: ${job.job_type}`);
            failed++;
            continue;
          }

          // Execute the handler
          const job_ctx = {
            trace_id: (claimed_job as Job).trace_id || ctx.trace_id,
            span_id: job.job_id,
          };

          await handler(job_ctx, claimed_job.payload);

          // Mark as completed
          await mark_job_completed(job.job_id);
          processed++;

          console.log(
            `[${ctx.trace_id}] Job ${job.job_id} completed successfully`
          );
        } catch (error) {
          console.error(
            `[${ctx.trace_id}] Job ${job.job_id} failed:`,
            error
          );

          const error_message = error instanceof Error
            ? error.message
            : "Unknown error";

          const will_retry = await mark_job_failed(job.job_id, error_message);

          if (will_retry) {
            console.log(
              `[${ctx.trace_id}] Job ${job.job_id} scheduled for retry`
            );
          } else {
            console.log(
              `[${ctx.trace_id}] Job ${job.job_id} moved to DLQ`
            );
          }

          failed++;
        }
      }

      log_operation_success(span, "system");

      console.log(
        `[${ctx.trace_id}] Job queue processing complete: ` +
        `processed=${processed}, failed=${failed}`
      );
    } catch (error) {
      log_operation_error(
        span,
        error instanceof Error ? error : new Error(String(error)),
        { user_id: "system", error_code: "JOB_QUEUE_PROCESSING_FAILED" }
      );
      throw error;
    }
  }
);
