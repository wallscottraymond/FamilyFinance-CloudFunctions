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
import { resolve_shared_assignment_context } from "../../resolvers/transactions/assignment_context.resolver";
import { PreloadedRecurringCandidates } from "../../resolvers/transactions/recurring_matches.resolver";
import type { SyncWrittenDoc } from "../../repositories/transaction.repo";
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
    preloaded_docs?: Array<{
        id: string;
        data: Record<string, unknown>;
        update_time?: Timestamp;
    }>;
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
    }) => {
        id: string;
        data: Record<string, unknown>;
        update_time?: Timestamp;
    };
}
/** One transaction's outcome (reported to `on_result`). */
export interface BatchTxnResult {
    transaction_id: string;
    data: Record<string, unknown>;
    /** Would be / was written. */
    write: boolean;
    /** Per split: monthly budget before → after. */
    moves: Array<{
        split_id: string;
        before: string;
        after: string;
    }>;
}
/** Result summary (handy for logs/tests). */
export interface AssignTransactionsBatchResult {
    processed: number;
    changed: number;
    not_found: number;
}
export declare function assign_transactions_batch_orchestrator(ctx: TraceContext, input: AssignTransactionsBatchInput): Promise<AssignTransactionsBatchResult>;
//# sourceMappingURL=assign_transactions_batch.orchestrator.d.ts.map