/**
 * Item sync lease — at most ONE sync per Plaid item at a time.
 *
 * Up to five things used to sync the same item at once (link-time sync, each webhook, the delayed
 * re-sync job, the 6-hour crons, manual refresh), each pulling and writing the same pages. Now
 * every one of them runs `sync_item`, which claims this lease first. A request that arrives while
 * a sync holds the lease just sets `requested`; the holder runs one more round before releasing,
 * so nothing is lost and nothing runs twice.
 *
 * Stored in an internal collection (not on the `plaid_items` doc) so lease churn doesn't wake the
 * app's live listener on the bank items.
 *
 * @module repositories/plaid/item_sync_lease
 */
/** Longer than a sync can run (the job function's timeout is 540 s), so a crash self-heals. */
export declare const SYNC_LEASE_TTL_MS: number;
export interface SyncRequest {
    /** Also refresh bills / income (Plaid's RECURRING_TRANSACTIONS webhook, or never synced). */
    recurring?: boolean;
}
export declare const item_sync_lease_repo: {
    /**
     * Try to take the lease for `run_id`. False = another sync holds it; the request has been
     * recorded on the lease so the holder runs again.
     */
    claim(item_doc_id: string, run_id: string, request: SyncRequest): Promise<boolean>;
    /**
     * End a round. If another request came in meanwhile, keep the lease (renewed) and return the
     * request so the holder runs again; otherwise release and return null.
     */
    finish_round(item_doc_id: string, run_id: string): Promise<SyncRequest | null>;
    /** Release after a failure (the next request starts a fresh sync). */
    release(item_doc_id: string, run_id: string): Promise<void>;
};
//# sourceMappingURL=item_sync_lease.repo.d.ts.map