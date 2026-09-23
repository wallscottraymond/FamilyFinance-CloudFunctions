/**
 * Assignment Watermark Repository
 *
 * Tracks, per user, the `updatedAt` cursor up to which transactions have been (re)assigned by the
 * debounced batch-assignment job. The job queries `transactions(userId, updatedAt > watermark)`,
 * assigns them via `assign_transactions_batch`, then advances the watermark — so a Plaid-sync burst
 * costs O(1) reference reads (shared context + recurring candidates resolved ONCE) instead of one
 * per-transaction job each re-reading every reference collection.
 *
 * Server-only (`allow read, write: if false`). 1 read + 1 write per batch run.
 *
 * @module repositories/assignment_watermark
 */
/**
 * Read the user's assignment watermark (epoch ms), or `null` if none yet.
 */
export declare function get_assignment_watermark_ms(user_id: string): Promise<number | null>;
/**
 * Advance the user's assignment watermark to `watermark_ms`. Called ONLY after a successful batch
 * so a failed/retried run re-processes from the old cursor (never strands unassigned txns).
 */
export declare function set_assignment_watermark_ms(user_id: string, watermark_ms: number): Promise<void>;
//# sourceMappingURL=assignment_watermark.repo.d.ts.map