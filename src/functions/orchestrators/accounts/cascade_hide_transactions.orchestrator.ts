/**
 * Cascade Hide Transactions Orchestrator
 *
 * Job handler that hides all transactions for a removed account.
 * Called asynchronously after account removal.
 *
 * @module orchestrators/accounts/cascade_hide_transactions
 */

import { getFirestore, Timestamp, WriteBatch } from "firebase-admin/firestore";
import {
  TraceContext,
  PerformanceBudget,
  create_performance_metrics,
  chunk_for_batch,
} from "../../types";
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
    const db = getFirestore();
    const now = Timestamp.now();

    // Query transactions for this account that are not already hidden
    const query = db
      .collection("transactions")
      .where("accountId", "==", input.plaid_account_id)
      .where("ownerId", "==", input.user_id)
      .where("isActive", "==", true)
      .limit(500); // Process in batches of 500

    const snapshot = await query.get();
    perf.reads++;

    if (snapshot.empty) {
      log_operation_success(span, input.user_id);
      return {
        transactions_hidden: 0,
        has_more: false,
        success: true,
      };
    }

    // Determine if we should exclude from budgets
    const exclude_from_budgets = input.removal_mode === "delete_history";

    // Update transactions in batches
    const doc_ids = snapshot.docs.map(doc => doc.id);
    const chunks = chunk_for_batch(doc_ids);
    let total_hidden = 0;

    for (const chunk of chunks) {
      const batch: WriteBatch = db.batch();

      for (const doc_id of chunk) {
        const doc_ref = db.collection("transactions").doc(doc_id);

        /* eslint-disable @typescript-eslint/naming-convention */
        const update_data: Record<string, unknown> = {
          isActive: false,
          isHidden: true,
          hiddenAt: now,
          hiddenReason: "account_removed",
          updatedAt: now,
        };

        if (exclude_from_budgets) {
          update_data.excludeFromBudgets = true;
        }
        /* eslint-enable @typescript-eslint/naming-convention */

        batch.update(doc_ref, update_data);
        total_hidden++;
      }

      await batch.commit();
      perf.writes += chunk.length;
    }

    // Check if there might be more transactions
    const has_more = snapshot.size === 500;

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
      `has_more=${has_more}, exclude_from_budgets=${exclude_from_budgets}`
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
