/**
 * Sync follow-ups — the ONE pass that runs after a Plaid sync's writes.
 *
 * A sync stamps its transaction writes with `syncRunId`, so `on_transaction_written` skips them
 * (no per-transaction assignment job, no recompute-per-day job, no reconcile-per-write job).
 * Instead the sync collects what its writes affected and runs this once, inline:
 *
 *   1. reconcile each affected bill / income stream (paid / received status) — once per stream
 *   2. recompute `spent` for each affected budget, over exactly the periods its dates fall in
 *   3. re-check internal transfers when transactions or streams changed
 *   4. bump the derive version once
 *
 * For a 3,000-transaction first link this replaces ~690 queued jobs (each waiting for the
 * 5-minute sweep) with one pass that finishes in the same invocation.
 *
 * @module orchestrators/plaid/sync_follow_ups
 */
import { TraceContext } from "../../types";
import type { SyncWrittenDoc } from "../../repositories/transaction.repo";
export interface SyncFollowUps {
    /** budget id → transaction dates (ms) whose periods need `spent` recomputed. */
    budget_dates: Record<string, number[]>;
    outflow_ids: string[];
    inflow_ids: string[];
    /** Any transaction written (drives the transfer re-check + derive bump). */
    transactions_changed: boolean;
    /** Bill / income streams created or changed (drives the transfer re-check + derive bump). */
    recurring_changed: boolean;
    /** A transfer transaction was written — the only kind that can form a new matched pair. */
    transfers_changed: boolean;
}
export declare const empty_follow_ups: () => SyncFollowUps;
/** What a set of transaction writes affects — before ∪ after, so an un-link or move is covered. */
export declare function follow_ups_from_written(written: SyncWrittenDoc[]): SyncFollowUps;
export declare function merge_follow_ups(a: SyncFollowUps, b: Partial<SyncFollowUps>): SyncFollowUps;
/** Run the follow-up pass once. Each step is non-fatal; a failed step falls back to a queued job. */
export declare function run_sync_follow_ups(ctx: TraceContext, user_id: string, f: SyncFollowUps, opts?: {
    /** Read the user's transactions across all the affected budget periods once (a convert). */
    preload_budget_window?: boolean;
}): Promise<void>;
//# sourceMappingURL=sync_follow_ups.d.ts.map