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
import { load_recurring_candidates } from "../../resolvers/transactions/recurring_matches.resolver";
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

/**
 * Fallback window (relative to now) over which recurring-match candidate periods are loaded ONCE
 * for the whole batch when we can't scope to the batch's own dates (see below). Must comfortably
 * exceed the matcher's ±90d window; older historical txns fall back to a per-transaction query.
 */
const CANDIDATE_LOOKBACK_MS = 400 * 24 * 60 * 60 * 1000;
const CANDIDATE_LOOKAHEAD_MS = 120 * 24 * 60 * 60 * 1000;

/** Matcher half-window: a txn can match a due period within ±90d of its date. */
const MATCH_MARGIN_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Above this batch size we skip the per-id date probe and use the fixed fallback window — a full
 * backfill would span all history anyway (so the probe wouldn't narrow anything) and the extra
 * per-id reads wouldn't pay off. Normal Plaid-sync batches are far smaller than this.
 */
const CANDIDATE_PROBE_MAX_IDS = 500;

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

    // Load recurring-match candidate periods ONCE for the whole batch instead of per
    // transaction (the top Firestore read line: outflow_periods/inflow_periods by
    // firstDueDateInPeriod). resolve_recurring_matches filters these to each txn's exact ±90d
    // window in memory, so matches are byte-for-byte identical; txns dated outside the loaded
    // window fall back to a per-transaction candidate query.
    //
    // Scope the load to the BATCH's actual transaction dates (±90d) rather than a fixed ~520d
    // span: an incremental sync touches only recent txns, so this collapses the candidate scan
    // from ~the entire *_periods collection to the relevant slice. A field-masked date probe
    // (batch-size reads) is far cheaper than reading every period doc. Fall back to the fixed
    // window for very large batches (full backfills), where the dates span everything anyway.
    const now_ms = Timestamp.now().toMillis();
    let window_start_ms = now_ms - CANDIDATE_LOOKBACK_MS;
    let window_end_ms = now_ms + CANDIDATE_LOOKAHEAD_MS;
    if (input.transaction_ids.length <= CANDIDATE_PROBE_MAX_IDS) {
      const dates_ms = await transaction_repo.get_dates_ms_by_ids(ctx, input.transaction_ids);
      if (dates_ms.length > 0) {
        window_start_ms = Math.min(...dates_ms) - MATCH_MARGIN_MS;
        window_end_ms = Math.max(...dates_ms) + MATCH_MARGIN_MS;
      }
    }
    const preloaded_candidates = await load_recurring_candidates(
      ctx,
      input.user_id,
      window_start_ms,
      window_end_ms
    );

    let processed = 0;
    let changed = 0;
    let not_found = 0;

    const assign_one = async (transaction_id: string): Promise<void> => {
      const resolved = await resolve_assignment_context(
        ctx,
        input.user_id,
        transaction_id,
        shared,
        preloaded_candidates
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
      const { updated_splits, name_changed, split_budget_ids, split_outflow_ids, split_inflow_ids } =
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
        split_budget_ids,
        split_outflow_ids,
        split_inflow_ids
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
