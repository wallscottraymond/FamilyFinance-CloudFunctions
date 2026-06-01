/**
 * Restore Account Recurring Orchestrator
 *
 * Job handler that restores soft-deleted recurring items for a restored account.
 * Sets `isActive: true` on outflows and inflows linked to the account.
 *
 * @module orchestrators/accounts/restore_account_recurring
 */

import {
  TraceContext,
  PerformanceBudget,
  create_performance_metrics,
} from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
  fire_and_forget,
  log_async_debug,
} from "../../observability";
import { outflow_repo, inflow_repo } from "../../repositories";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

/**
 * Performance budget for restore_account_recurring job.
 */
const _BUDGET: PerformanceBudget = {
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
 * Input for restore account recurring job.
 */
export interface RestoreAccountRecurringInput {
  /** Plaid account ID to restore recurring items for */
  plaid_account_id: string;

  /** User ID who owns the account */
  user_id: string;

  /** Trace ID from the parent operation */
  trace_id: string;
}

/**
 * Result of restore account recurring job.
 */
export interface RestoreAccountRecurringResult {
  /** Whether the job completed successfully */
  success: boolean;

  /** Number of outflows restored */
  outflows_restored: number;

  /** Number of inflows restored */
  inflows_restored: number;
}

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
export async function restore_account_recurring_orchestrator(
  ctx: TraceContext,
  input: RestoreAccountRecurringInput
): Promise<RestoreAccountRecurringResult> {
  const span = create_span(ctx, "orchestrator", "restore_account_recurring");
  const perf = create_performance_metrics();
  log_operation_start(span, input.user_id);

  try {
    const db = getFirestore();
    let outflows_restored = 0;
    let inflows_restored = 0;

    // 1. Get soft-deleted outflows for this account
    const outflows = await outflow_repo.get_by_account_id(
      ctx,
      input.plaid_account_id,
      { include_deleted: true }
    );
    perf.reads++;

    // Filter to only inactive (soft-deleted) outflows
    const deleted_outflows = outflows.filter(o => !o.is_active);

    if (deleted_outflows.length > 0) {
      console.log(
        `[${ctx.trace_id}] Restoring ${deleted_outflows.length} outflows for account ${input.plaid_account_id}`
      );

      // Batch restore outflows
      for (let i = 0; i < deleted_outflows.length; i += BATCH_SIZE) {
        const batch_items = deleted_outflows.slice(i, i + BATCH_SIZE);
        const batch = db.batch();

        for (const outflow of batch_items) {
          const doc_ref = db.collection("outflows").doc(outflow.id);
          batch.update(doc_ref, {
            isActive: true,
            restoredAt: Timestamp.now(),
          });
        }

        await batch.commit();
        outflows_restored += batch_items.length;
        perf.writes++;
      }
    }

    // 2. Get soft-deleted inflows for this account
    const inflows = await inflow_repo.get_by_account_id(
      ctx,
      input.plaid_account_id,
      { include_deleted: true }
    );
    perf.reads++;

    // Filter to only inactive (soft-deleted) inflows
    const deleted_inflows = inflows.filter(i => !i.is_active);

    if (deleted_inflows.length > 0) {
      console.log(
        `[${ctx.trace_id}] Restoring ${deleted_inflows.length} inflows for account ${input.plaid_account_id}`
      );

      // Batch restore inflows
      for (let i = 0; i < deleted_inflows.length; i += BATCH_SIZE) {
        const batch_items = deleted_inflows.slice(i, i + BATCH_SIZE);
        const batch = db.batch();

        for (const inflow of batch_items) {
          const doc_ref = db.collection("inflows").doc(inflow.id);
          batch.update(doc_ref, {
            isActive: true,
            restoredAt: Timestamp.now(),
          });
        }

        await batch.commit();
        inflows_restored += batch_items.length;
        perf.writes++;
      }
    }

    log_operation_success(span, input.user_id);

    // 3. Async debug logging
    fire_and_forget(() =>
      log_async_debug({
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
      })
    );

    console.log(
      `[${ctx.trace_id}] restore_account_recurring: ` +
      `account=${input.plaid_account_id}, ` +
      `outflows=${outflows_restored}, inflows=${inflows_restored}`
    );

    return {
      success: true,
      outflows_restored,
      inflows_restored,
    };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id: input.user_id, error_code: "RESTORE_RECURRING_FAILED" }
    );
    throw error;
  }
}
