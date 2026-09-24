/**
 * Recurring-Reconcile Watermark Repository
 *
 * Tracks, per user, the recurring-doc `updatedAt` cursor up to which the debounced
 * per-user recurring reconcile job has processed. Mirrors `_assignment_watermarks`
 * (TR-2/TR-3): a bulk bill/income import (or a Plaid recurring sync) used to enqueue
 * TWO durable jobs PER recurring doc (`assign_recurring_transactions` +
 * `reconcile_recurring_period`) — so importing M streams fanned out to ~2M jobs. Now
 * each `on_{outflow,inflow}_created` trigger enqueues ONE deduped
 * `reconcile_user_recurring:{uid}` job; that job reads this watermark, processes every
 * recurring updated since it (assign + reconcile), then advances the cursor.
 *
 * Server-only (`allow read, write: if false`). 1 read + 1 write per debounced run.
 *
 * @module repositories/recurring_reconcile_watermark
 */
/**
 * Read the user's recurring-reconcile watermark (epoch ms), or `null` if none yet.
 */
export declare function get_recurring_reconcile_watermark_ms(user_id: string): Promise<number | null>;
/**
 * Advance the user's recurring-reconcile watermark to `watermark_ms` (the max `updatedAt`
 * of the recurring docs actually processed this run — never past an unprocessed row).
 */
export declare function set_recurring_reconcile_watermark_ms(user_id: string, watermark_ms: number): Promise<void>;
//# sourceMappingURL=recurring_reconcile_watermark.repo.d.ts.map