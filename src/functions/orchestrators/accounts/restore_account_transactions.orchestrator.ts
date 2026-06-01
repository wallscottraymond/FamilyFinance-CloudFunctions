/**
 * Restore Account Transactions Orchestrator
 *
 * Job handler that unhides transactions for a restored account.
 * Sets `isHidden: false` on all transactions for the account.
 *
 * @module orchestrators/accounts/restore_account_transactions
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
import { transaction_repo } from "../../repositories";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Performance budget for restore_account_transactions job.
 */
const _BUDGET: PerformanceBudget = {
  max_reads: 50,
  max_writes: 500,
  max_time_ms: 30000,
};
void _BUDGET; // Reserved for future budget checking

/**
 * Batch size for transaction updates.
 */
const BATCH_SIZE = 500;

/**
 * Input for restore account transactions job.
 */
export interface RestoreAccountTransactionsInput {
  /** Plaid account ID to restore transactions for */
  plaid_account_id: string;

  /** User ID who owns the account */
  user_id: string;

  /** Trace ID from the parent operation */
  trace_id: string;
}

/**
 * Result of restore account transactions job.
 */
export interface RestoreAccountTransactionsResult {
  /** Whether the job completed successfully */
  success: boolean;

  /** Number of transactions restored (unhidden) */
  transactions_restored: number;
}

/**
 * Orchestrates restoring (unhiding) transactions for a restored account.
 *
 * This is a job handler - called by the job queue processor.
 *
 * Flow:
 * 1. Get hidden transaction IDs for the account
 * 2. Batch update to set isHidden: false
 *
 * @param ctx - Trace context (from job payload)
 * @param input - Job input
 * @returns Restore result
 */
export async function restore_account_transactions_orchestrator(
  ctx: TraceContext,
  input: RestoreAccountTransactionsInput
): Promise<RestoreAccountTransactionsResult> {
  const span = create_span(ctx, "orchestrator", "restore_account_transactions");
  const perf = create_performance_metrics();
  log_operation_start(span, input.user_id);

  try {
    // 1. Get hidden transaction IDs for this account
    const transaction_ids = await transaction_repo.get_ids_by_account_id(
      ctx,
      input.plaid_account_id,
      input.user_id,
      BATCH_SIZE * 10 // Allow larger batches for restore
    );
    perf.reads++;

    if (transaction_ids.length === 0) {
      console.log(
        `[${ctx.trace_id}] No transactions to restore for account ${input.plaid_account_id}`
      );
      return { success: true, transactions_restored: 0 };
    }

    console.log(
      `[${ctx.trace_id}] Restoring ${transaction_ids.length} transactions for account ${input.plaid_account_id}`
    );

    // 2. Batch update transactions to unhide them
    const db = getFirestore();
    let restored_count = 0;

    for (let i = 0; i < transaction_ids.length; i += BATCH_SIZE) {
      const batch_ids = transaction_ids.slice(i, i + BATCH_SIZE);
      const batch = db.batch();

      for (const tx_id of batch_ids) {
        const doc_ref = db.collection("transactions").doc(tx_id);
        batch.update(doc_ref, {
          isHidden: false,
          // Note: We don't change excludeFromBudgets here
          // That's a user choice that persists across hide/restore
        });
      }

      await batch.commit();
      restored_count += batch_ids.length;
      perf.writes++;

      console.log(
        `[${ctx.trace_id}] Restored batch ${Math.floor(i / BATCH_SIZE) + 1}: ` +
        `${batch_ids.length} transactions`
      );
    }

    log_operation_success(span, input.user_id);

    // 3. Async debug logging
    fire_and_forget(() =>
      log_async_debug({
        trace_id: ctx.trace_id,
        span_id: span.span_id,
        layer: "orchestrator",
        function: "restore_account_transactions",
        status: "success",
        context: {
          account_id: input.plaid_account_id,
          transactions_restored: restored_count,
          perf_reads: perf.reads,
          perf_writes: perf.writes,
        },
      })
    );

    console.log(
      `[${ctx.trace_id}] restore_account_transactions: ` +
      `account=${input.plaid_account_id}, restored=${restored_count}`
    );

    return {
      success: true,
      transactions_restored: restored_count,
    };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id: input.user_id, error_code: "RESTORE_TRANSACTIONS_FAILED" }
    );
    throw error;
  }
}
