/**
 * Cascade Hide Transactions Orchestrator
 *
 * Job handler that hides all transactions for a removed account.
 * Called asynchronously after account removal.
 *
 * @module orchestrators/accounts/cascade_hide_transactions
 */

import {
  TraceContext,
  PerformanceBudget,
  create_performance_metrics,
} from "../../types";
import { transaction_repo } from "../../repositories/transaction.repo";
import { bump_derive_version } from "../../repositories/derive_version.repo";
import { create_job } from "../../infrastructure/job_queue";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
  fire_and_forget,
  log_async_debug,
} from "../../observability";
import { RemovalMode } from "../../domain";

/**
 * Performance budget for cascade operation.
 * Note: Used for documentation/reference, actual enforcement TBD.
 */
const _BUDGET: PerformanceBudget = {
  max_reads: 50,
  max_writes: 500, // May need to update many transactions
  max_time_ms: 30000, // 30 seconds for batch operations
};
void _BUDGET; // Referenced for documentation

/**
 * Input for the cascade hide transactions job.
 */
export interface CascadeHideTransactionsInput {
  /** Plaid account ID (used to filter transactions) */
  plaid_account_id: string;

  /** User ID */
  user_id: string;

  /** How to handle history */
  removal_mode: RemovalMode;

  /** Trace ID from parent operation */
  trace_id: string;
}

/**
 * Result of the cascade operation.
 */
export interface CascadeHideTransactionsResult {
  /** Number of transactions hidden */
  transactions_hidden: number;

  /** Whether there are more transactions to process */
  has_more: boolean;

  /** Whether the operation completed successfully */
  success: boolean;
}

/**
 * Orchestrates hiding transactions for a removed account.
 *
 * This is designed to be idempotent - running multiple times
 * with the same input will produce the same result.
 *
 * @param ctx - Trace context
 * @param input - Job input
 * @returns Result with count of hidden transactions
 */
export async function cascade_hide_transactions_orchestrator(
  ctx: TraceContext,
  input: CascadeHideTransactionsInput
): Promise<CascadeHideTransactionsResult> {
  const span = create_span(ctx, "orchestrator", "cascade_hide_transactions");
  const perf = create_performance_metrics();
  log_operation_start(span, input.user_id);

  try {
    // Removing an account removes its transactions from budgets too (decided
    // 2026-10-05; the "Keep in Budgets" choice was dropped — it never worked,
    // since derive ignores inactive transactions). `removal_mode` stays on the
    // payload only for older app builds. One page of ≤500 per run.
    const { hidden: total_hidden, has_more } =
      await transaction_repo.hide_for_account(
        ctx,
        input.plaid_account_id,
        input.user_id
      );
    perf.reads++;
    perf.writes += total_hidden;

    if (total_hidden === 0) {
      log_operation_success(span, input.user_id);
      return {
        transactions_hidden: 0,
        has_more: false,
        success: true,
      };
    }

    // Hidden txns drop out of derive — invalidate the cache (TR-2, trigger no longer bumps).
    // One bump per page; a paginated cascade re-invokes this handler and bumps each page.
    await bump_derive_version(input.user_id).catch(() => {});

    // A full page means more may remain — continue in a follow-up job (the
    // account had 5k+ transactions; only the first 500 used to be hidden).
    if (has_more) {
      await create_job("cascade_hide_transactions", input, { trace_id: input.trace_id });
    }

    log_operation_success(span, input.user_id);

    // Async debug logging
    fire_and_forget(() =>
      log_async_debug({
        trace_id: ctx.trace_id,
        span_id: span.span_id,
        layer: "orchestrator",
        function: "cascade_hide_transactions",
        status: "success",
        context: {
          plaid_account_id: input.plaid_account_id,
          removal_mode: input.removal_mode,
          transactions_hidden: total_hidden,
          has_more,
          perf_reads: perf.reads,
          perf_writes: perf.writes,
        },
      })
    );

    console.log(
      `[${ctx.trace_id}] cascade_hide_transactions: hidden=${total_hidden}, ` +
      `has_more=${has_more}`
    );

    return {
      transactions_hidden: total_hidden,
      has_more,
      success: true,
    };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id: input.user_id, error_code: "CASCADE_HIDE_TRANSACTIONS_FAILED" }
    );
    throw error;
  }
}
