/**
 * Balance Snapshot Repository — Goals (Phase 0)
 *
 * Append-only history of account balances over time. The app stores only each
 * account's CURRENT balance (overwritten on every sync), so there is no way to
 * ask "what was this balance at the start of the period?" — which the Goals
 * feature needs to measure per-period balance deltas.
 *
 * This repo records a dated balance point whenever an account's balance is
 * created or changes (written from the balance-sync orchestrators, which already
 * detect the change). Unchanged balances are NOT re-recorded — a delta between
 * two period boundaries is computed from the latest point at-or-before each
 * boundary, so gaps are fine.
 *
 * Owns the `account_balance_snapshots` collection.
 *
 * @module repositories/balance_snapshot
 */
import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../types";
/** A single dated balance point for one account. */
export interface BalanceSnapshot {
    id: string;
    accountId: string;
    userId: string;
    itemId?: string;
    currentBalance: number;
    /** When this balance was observed. */
    ts: Timestamp;
}
/** Input for one snapshot append (ts is stamped by the repo). */
export interface BalanceSnapshotInput {
    account_id: string;
    user_id: string;
    item_id?: string;
    current_balance: number;
}
export declare const balance_snapshot_repo: {
    /**
     * Append dated balance points (one batch). Doc id is `${accountId}_${ts_ms}`
     * so concurrent writers for the same account at the same instant collide
     * idempotently rather than duplicating. Caller decides which accounts changed.
     */
    append(ctx: TraceContext, inputs: BalanceSnapshotInput[]): Promise<number>;
    /**
     * The latest balance point at or before `ts` for an account (used as a period
     * boundary reading). Returns null when the account has no snapshot yet.
     *
     * Requires composite index: account_balance_snapshots (accountId ASC, ts DESC).
     */
    get_at_or_before(account_id: string, ts: Timestamp): Promise<BalanceSnapshot | null>;
    /** The most recent balance point for an account (null if none yet). */
    get_latest(account_id: string): Promise<BalanceSnapshot | null>;
};
//# sourceMappingURL=balance_snapshot.repo.d.ts.map