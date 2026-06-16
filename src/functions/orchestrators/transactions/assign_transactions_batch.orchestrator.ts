/**
 * Assign Transactions Batch Orchestrator
 *
 * Bulk variant of `assign_transaction`: assigns the splits of MANY of a user's
 * transactions in ONE invocation, resolving the transaction-independent context
 * (budgets + categories) ONCE and reusing it across every transaction. This
 * removes the per-transaction re-read of budgets + the categories collection
 * that dominates a large re-assignment (e.g. the backfill migration).
 *
 * Assignment-only: it writes the engine-owned split fields but does NOT fan out
 * per-transaction `recompute_budget_spent` jobs — bulk callers (the backfill)
 * run a single authoritative full recompute per budget afterwards, so per-txn
 * scoped recomputes would be redundant. For single, trigger-driven edits use
 * `assign_transaction` (which keeps the scoped fan-out).
 *
 * @module orchestrators/transactions/assign_transactions_batch
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import {
  resolve_assignment_context,
  resolve_shared_assignment_context,
} from "../../resolvers/transactions/assignment_context.resolver";
import {
  compute_transaction_assignment,
} from "../../domain/transactions/compute_transaction_assignment.service";
import { merge_assignment_onto_raw_splits } from "./merge_assignment";
import { transaction_repo } from "../../repositories/transaction.repo";

/** Input: assign every listed transaction for one user. */
export interface AssignTransactionsBatchInput {
  user_id: string;
  transaction_ids: string[];
}

/** Result summary (handy for logs/tests). */
export interface AssignTransactionsBatchResult {
  processed: number;
  changed: number;
  not_found: number;
}

/**
 * How many transactions to resolve+write concurrently. Bounds open Firestore
 * sockets per invocation while still overlapping the per-transaction I/O.
 */
const CONCURRENCY = 20;

export async function assign_transactions_batch_orchestrator(
  ctx: TraceContext,
  input: AssignTransactionsBatchInput
): Promise<AssignTransactionsBatchResult> {
  const span = create_span(ctx, "orchestrator", "assign_transactions_batch");
  log_operation_start(span, input.user_id);

  try {
    if (input.transaction_ids.length === 0) {
      log_operation_success(span, input.user_id);
      return { processed: 0, changed: 0, not_found: 0 };
    }

    // Resolve the transaction-independent context ONCE for the whole batch.
    const shared = await resolve_shared_assignment_context(ctx, input.user_id);

    let processed = 0;
    let changed = 0;
    let not_found = 0;

    const assign_one = async (transaction_id: string): Promise<void> => {
      const resolved = await resolve_assignment_context(
        ctx,
        input.user_id,
        transaction_id,
        shared
      );
      if (!resolved) {
        not_found++;
        return;
      }

      const result = compute_transaction_assignment(
        resolved.splits_input,
        resolved.context
      );

      const now = Timestamp.now();
      const { updated_splits, name_changed, split_budget_ids } =
        merge_assignment_onto_raw_splits(resolved, result, now);

      // Skip-if-unchanged: nothing to write (matches single-item semantics).
      if (!result.changed && !name_changed) {
        processed++;
        return;
      }

      await transaction_repo.apply_split_assignments(
        ctx,
        resolved.transaction_doc_id,
        updated_splits,
        split_budget_ids
      );
      processed++;
      if (result.changed) {
        changed++;
      }
    };

    // Process in bounded-concurrency windows.
    for (let i = 0; i < input.transaction_ids.length; i += CONCURRENCY) {
      const window = input.transaction_ids.slice(i, i + CONCURRENCY);
      await Promise.all(window.map((id) => assign_one(id)));
    }

    console.log(
      `[${ctx.trace_id}] assign_transactions_batch: user=${input.user_id} ` +
        `processed=${processed} changed=${changed} not_found=${not_found}`
    );
    log_operation_success(span, input.user_id);
    return { processed, changed, not_found };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id: input.user_id, error_code: "ASSIGN_TRANSACTIONS_BATCH_FAILED" }
    );
    throw error;
  }
}
