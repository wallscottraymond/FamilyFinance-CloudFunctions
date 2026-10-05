/**
 * Restore Account Transactions Orchestrator
 *
 * Job handler that unhides transactions for a restored account.
 * Reactivates the transactions an account removal hid (paged, 500 per job).
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
import { bump_derive_version } from "../../repositories/derive_version.repo";
import { create_job } from "../../infrastructure/job_queue";

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
 * 1. Reactivate one page (≤500) of the account's removal-hidden transactions
 * 2. Re-enqueue itself while a full page came back
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
    // 1. Restore one page of the transactions the account removal hid. Only
    //    hiddenReason "account_removed" — rows soft-deleted for other reasons
    //    (superseded pendings, etc.) must stay deleted.
    const { restored: restored_count, has_more } =
      await transaction_repo.restore_for_account(
        ctx,
        input.plaid_account_id,
        input.user_id
      );
    perf.reads++;
    perf.writes += restored_count;

    if (restored_count === 0) {
      console.log(
        `[${ctx.trace_id}] No transactions to restore for account ${input.plaid_account_id}`
      );
      return { success: true, transactions_restored: 0 };
    }

    // A full page means more may remain — continue in a follow-up job.
    if (has_more) {
      await create_job("restore_account_transactions", input, { trace_id: input.trace_id });
    }

    // Restored txns re-enter derive — invalidate the cache (TR-2, trigger no longer bumps).
    await bump_derive_version(input.user_id).catch(() => {});

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
