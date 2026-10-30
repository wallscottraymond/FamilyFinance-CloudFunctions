/**
 * Sync Item Orchestrator — THE way a Plaid item is synced (first link, webhooks, crons, manual
 * refresh, re-auth). One writer per item, one write per transaction, one follow-up pass.
 *
 *   1. Lease: at most one sync per item; a request during a sync makes the holder run again.
 *   2. Bills / income FIRST (when Plaid has them and they're due), so the assignment engine's
 *      authoritative stream membership is in place before any transaction is written.
 *   3. Transactions: every page pulled, assigned IN MEMORY, written ONCE (`syncRunId` stamped —
 *      the per-transaction trigger skips them).
 *   4. New streams: their periods generated inline (the create trigger skips sync-stamped
 *      streams), and transactions written BEFORE their stream existed are linked once.
 *   5. ONE follow-up pass: reconcile affected bills/income, recompute affected budget periods,
 *      re-check internal transfers, bump the derive version once.
 *
 * Replaces, for a first link: the bare transaction write + read-back + re-write, ~650
 * recompute-per-day jobs, ~3 reconciles per stream, and a chain of 5-minute sweep waits.
 *
 * @module orchestrators/plaid/sync_item
 */
import { TraceContext } from "../../types";
export interface SyncItemInput {
    /** plaid_items document id. */
    item_doc_id: string;
    user_id: string;
    /** Also refresh bills / income this round. */
    recurring?: boolean;
    /** Fallback attempt counter while Plaid's first pull isn't ready. */
    attempt?: number;
    reason?: string;
}
export interface SyncItemResult {
    status: "synced" | "already_running" | "skipped" | "failed";
    rounds: number;
    added: number;
    modified: number;
    removed: number;
    streams_written: number;
    error?: string;
}
/** Enqueue a sync for an item — every entry point uses this (webhook, link, cron, retry). */
export declare function enqueue_item_sync(input: {
    item_doc_id: string;
    user_id: string;
    recurring?: boolean;
    delay_seconds?: number;
    attempt?: number;
    reason?: string;
    trace_id?: string;
}): Promise<void>;
export declare function sync_item_orchestrator(ctx: TraceContext, input: SyncItemInput): Promise<SyncItemResult>;
//# sourceMappingURL=sync_item.orchestrator.d.ts.map