/**
 * Assign Transactions Batch Orchestrator
 *
 * Bulk variant of `assign_transaction`: assigns the splits of MANY of a user's
 * transactions in ONE invocation, resolving the transaction-independent context
 * (budgets + categories) ONCE and reusing it across every transaction. This
 * removes the per-transaction re-read of budgets + the categories collection
 * that dominates a large re-assignment (e.g. the backfill migration).
 *
 * One follow-up per batch: every write is stamped `assignRunId`, so `on_transaction_written`
 * skips the engine's own writes (they used to re-enter it — one assignment job + one
 * recompute-per-day job per write, ~650 jobs on a first link). The batch then runs ONE follow-up
 * pass itself (reconcile touched bills/income, recompute touched budget periods, one derive bump),
 * or hands its writes to a caller that merges them into its own pass (`collect_into`).
 *
 * @module orchestrators/transactions/assign_transactions_batch
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { create_job } from "../../infrastructure/job_queue";
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
  load_recurring_candidates,
  load_recurring_candidates_scoped,
  PreloadedRecurringCandidates,
} from "../../resolvers/transactions/recurring_matches.resolver";
import {
  compute_transaction_assignment,
} from "../../domain/transactions/compute_transaction_assignment.service";
import { merge_assignment_onto_raw_splits } from "./merge_assignment";
import { transaction_repo } from "../../repositories/transaction.repo";
import { source_period_repo } from "../../repositories/source_period.repo";
import type { SyncWrittenDoc } from "../../repositories/transaction.repo";
import { follow_ups_from_written, run_sync_follow_ups } from "../plaid/sync_follow_ups";
import { SourcePeriodForMatch } from "../../domain/transactions/match_source_periods.service";

/** Input: assign every listed transaction for one user. */
export interface AssignTransactionsBatchInput {
  user_id: string;
  transaction_ids: string[];
  /**
   * Optional recurring-candidate SCOPE (read-cost #1). When present, the candidate preload reads
   * only these streams' outflow/inflow periods instead of ALL the user's due periods. Set ONLY by
   * callers whose txns are exactly these streams' membership (the recurring-reconcile path); the
   * sync/backfill/rehome paths omit it and keep the full-candidate scan.
   */
  candidate_outflow_ids?: string[];
  candidate_inflow_ids?: string[];
  /** Stamped as `assignRunId` on each write (defaults to the trace id). */
  run_id?: string;
  /** Caller runs the follow-up pass: the batch appends its writes here and skips its own. */
  collect_into?: SyncWrittenDoc[];
  /**
   * In-process callers only (the bounded re-assign engine, 3-R):
   *   - `preloaded_docs`: the docs, already read (skips the bulk read) — possibly transformed in
   *     memory (3-0b), so they're written even when the engine's own fields didn't change when
   *     listed in `force_write_ids`; `extra_fields_by_id` rides along in the same write.
   *   - `dry_run`: compute only — no writes, no follow-ups; `on_result` still reports.
   */
  preloaded_docs?: Array<{ id: string; data: Record<string, unknown>; update_time?: Timestamp }>;
  /** Reference data the caller already resolved for this user (a multi-page run loads it ONCE
   *  per invocation, not once per page). */
  preloaded_shared?: Awaited<ReturnType<typeof resolve_shared_assignment_context>>;
  /** Bill / income candidate periods the caller already loaded; used when their window covers
   *  this batch's dates ±90 days (matching filters each transaction to its own ±90 days). */
  preloaded_candidates?: PreloadedRecurringCandidates;
  force_write_ids?: Set<string>;
  extra_fields_by_id?: Map<string, Record<string, unknown>>;
  dry_run?: boolean;
  on_result?: (r: BatchTxnResult) => void;
  /** A conflicted transaction is re-read and retried; a caller that transformed its preloaded
   *  docs in memory applies the same transform to the fresh read here (it may add to
   *  `force_write_ids` / `extra_fields_by_id`). */
  prepare_fresh?: (doc: {
    id: string;
    data: Record<string, unknown>;
    update_time?: Timestamp;
  }) => { id: string; data: Record<string, unknown>; update_time?: Timestamp };
}

/** Rounds of re-read + retry for transactions whose write lost a race; what still conflicts
 *  after that gets its own batch job (never left un-assigned). */
const CONFLICT_RETRY_ROUNDS = 2;

/** One transaction's outcome (reported to `on_result`). */
export interface BatchTxnResult {
  transaction_id: string;
  data: Record<string, unknown>;
  /** Would be / was written. */
  write: boolean;
  /** Per split: monthly budget before → after. */
  moves: Array<{ split_id: string; before: string; after: string }>;
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
    const shared =
      input.preloaded_shared ?? (await resolve_shared_assignment_context(ctx, input.user_id));

    // Bulk-read the batch's txn docs ONCE (dates come along for free) — replaces the
    // per-transaction `get_raw_by_id` inside resolve_assignment_context AND the old field-masked
    // date probe. Inactive/missing docs are skipped by the repo.
    const now_ms = Timestamp.now().toMillis();
    const txn_docs =
      input.preloaded_docs ?? (await transaction_repo.get_raw_by_ids(ctx, input.transaction_ids));
    const dates_ms = txn_docs.map((t) => (t.data.transactionDate as Timestamp).toMillis());

    // Load recurring-match candidate periods ONCE (outflow_periods/inflow_periods), scoped to the
    // batch's actual txn dates ±90d — ALWAYS (dates are bulk-read; min/max is free). This guarantees
    // every txn's ±90d window is covered by the single preload, so the per-txn `load_*_candidates`
    // FALLBACK never fires. (The old size gate used a fixed now±window for >500-id batches, leaving
    // old expenses uncovered → a per-txn outflow_periods query each = the 1.16M-read top line.)
    let window_start_ms = now_ms - CANDIDATE_LOOKBACK_MS;
    let window_end_ms = now_ms + CANDIDATE_LOOKAHEAD_MS;
    if (dates_ms.length > 0) {
      window_start_ms = Math.min(...dates_ms) - MATCH_MARGIN_MS;
      window_end_ms = Math.max(...dates_ms) + MATCH_MARGIN_MS;
    }

    // Preload the source periods overlapping the batch's date SPAN ONCE (source_periods is a
    // global calendar collection; a per-txn `get_overlapping` here was O(N)/sync). The resolver
    // filters this set to each txn's date in memory.
    const span_start_ms = dates_ms.length ? Math.min(...dates_ms) : now_ms;
    const span_end_ms = dates_ms.length ? Math.max(...dates_ms) : now_ms;
    // When the caller scopes candidates to known streams (recurring-reconcile), read ONLY those
    // streams' periods (read-cost #1); otherwise scan the user's full due-window set (sync path).
    const scoped =
      (input.candidate_outflow_ids?.length ?? 0) > 0 ||
      (input.candidate_inflow_ids?.length ?? 0) > 0;
    const caller_candidates =
      input.preloaded_candidates &&
      input.preloaded_candidates.window_start_ms <= window_start_ms &&
      input.preloaded_candidates.window_end_ms >= window_end_ms
        ? input.preloaded_candidates
        : null;
    const [preloaded_candidates, overlapping_source_periods] = await Promise.all([
      caller_candidates
        ? Promise.resolve(caller_candidates)
        : scoped
          ? load_recurring_candidates_scoped(
            ctx,
            input.candidate_outflow_ids ?? [],
            input.candidate_inflow_ids ?? [],
            window_start_ms,
            window_end_ms
          )
          : load_recurring_candidates(ctx, input.user_id, window_start_ms, window_end_ms),
      source_period_repo.get_overlapping(
        ctx,
        Timestamp.fromMillis(span_start_ms),
        Timestamp.fromMillis(span_end_ms)
      ),
    ]);
    const preloaded_source_periods: SourcePeriodForMatch[] =
      overlapping_source_periods.map((p) => ({
        id: p.id,
        type: p.period_type,
        start_ms: p.start_date.toMillis(),
        end_ms: p.end_date.toMillis(),
      }));

    const run_id = input.run_id ?? ctx.trace_id;
    const written: SyncWrittenDoc[] = [];
    let processed = 0;
    let changed = 0;
    let wrote = 0; // any committed write (assignment or name change) — both feed derive
    let conflicts = 0; // skipped: the doc changed after we read it
    const not_found = input.transaction_ids.length - txn_docs.length;

    /** Returns false when the write lost a race (the doc changed after it was read). */
    const assign_one = async (
      txn: { id: string; data: Record<string, unknown> }
    ): Promise<boolean> => {
      const resolved = await resolve_assignment_context(
        ctx,
        input.user_id,
        txn.id,
        shared,
        preloaded_candidates,
        txn,
        preloaded_source_periods
      );
      if (!resolved) {
        return true;
      }

      const result = compute_transaction_assignment(
        resolved.splits_input,
        resolved.context
      );

      const now = Timestamp.now();
      const { updated_splits, name_changed, split_budget_ids, split_outflow_ids, split_inflow_ids } =
        merge_assignment_onto_raw_splits(resolved, result, now);
      const forced = input.force_write_ids?.has(txn.id) === true;
      const write = result.changed || name_changed || forced;
      // Reported once the outcome is final (a conflicted write is reported by its retry).
      const report = () => {
        if (!input.on_result) return;
        const before_by_split = new Map(
          resolved.splits_input.map((s) => [s.split_id, s.monthly_budget_id ?? s.budget_id])
        );
        input.on_result({
          transaction_id: txn.id,
          data: txn.data,
          write,
          moves: result.splits
            .filter((s) => before_by_split.get(s.split_id) !== s.monthly_budget_id)
            .map((s) => ({
              split_id: s.split_id,
              before: before_by_split.get(s.split_id) ?? "unassigned",
              after: s.monthly_budget_id,
            })),
        });
      };

      // Skip-if-unchanged: nothing to write (single-item semantics). A dry run never writes.
      if (!write || input.dry_run) {
        report();
        processed++;
        return true;
      }

      const applied = await transaction_repo.apply_split_assignments(
        ctx,
        resolved.transaction_doc_id,
        updated_splits,
        split_budget_ids,
        split_outflow_ids,
        split_inflow_ids,
        run_id,
        input.extra_fields_by_id?.get(txn.id),
        // Never overwrite a write that landed after our read (a user's edit, a sync).
        (txn as { update_time?: Timestamp }).update_time
      );
      if (!applied) {
        conflicts++;
        return false;
      }
      report();
      /* eslint-disable @typescript-eslint/naming-convention */
      written.push({
        doc_id: resolved.transaction_doc_id,
        before: txn.data,
        after: {
          ...txn.data,
          splits: updated_splits,
          splitBudgetIds: split_budget_ids,
          splitOutflowIds: split_outflow_ids,
          splitInflowIds: split_inflow_ids,
        },
      });
      /* eslint-enable @typescript-eslint/naming-convention */
      processed++;
      wrote++;
      if (result.changed || forced) {
        changed++;
      }
      return true;
    };

    // Process in bounded-concurrency windows. A write that lost a race (a status tap, a sync
    // landed after our read) is re-read and retried — a stamped spend-only edit never runs the
    // engine itself, so skipping it would leave the transaction on its old assignment.
    let lost: string[] = [];
    try {
      let todo: Array<{ id: string; data: Record<string, unknown>; update_time?: Timestamp }> =
        txn_docs;
      for (let round = 0; ; round++) {
        lost = [];
        for (let i = 0; i < todo.length; i += CONCURRENCY) {
          const window = todo.slice(i, i + CONCURRENCY);
          const ok = await Promise.all(window.map((t) => assign_one(t)));
          ok.forEach((applied, k) => {
            if (!applied) lost.push(window[k].id);
          });
        }
        if (!lost.length || round >= CONFLICT_RETRY_ROUNDS) break;
        const fresh = await transaction_repo.get_raw_by_ids(ctx, lost);
        todo = input.prepare_fresh ? fresh.map(input.prepare_fresh) : fresh;
        processed += lost.length - fresh.length; // gone / deactivated since
      }
      if (lost.length) {
        // Still racing after the retries: its own batch job (fresh read, own retries).
        processed += lost.length;
        await create_job(
          "assign_transactions_batch",
          { user_id: input.user_id, transaction_ids: lost },
          { trace_id: ctx.trace_id, delay_seconds: 30 }
        );
      }
    } finally {
      // ONE follow-up for the whole batch (the trigger skips these stamped writes). In `finally`
      // so writes that committed before a failure are still followed up (a retry would see them
      // as unchanged and do nothing).
      if (wrote > 0) {
        if (input.collect_into) {
          input.collect_into.push(...written);
        } else {
          await run_sync_follow_ups(ctx, input.user_id, follow_ups_from_written(written));
        }
      }
    }

    console.log(
      `[${ctx.trace_id}] assign_transactions_batch: user=${input.user_id} ` +
        `processed=${processed} changed=${changed} not_found=${not_found} conflicts=${conflicts}`
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
