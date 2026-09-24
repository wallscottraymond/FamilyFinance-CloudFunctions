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

import { getFirestore, Timestamp } from "firebase-admin/firestore";

const COLLECTION = "_recurring_reconcile_watermarks";

/**
 * Read the user's recurring-reconcile watermark (epoch ms), or `null` if none yet.
 */
export async function get_recurring_reconcile_watermark_ms(
  user_id: string
): Promise<number | null> {
  const snap = await getFirestore().collection(COLLECTION).doc(user_id).get();
  if (!snap.exists) return null;
  const ms = snap.data()?.watermark_ms;
  return typeof ms === "number" ? ms : null;
}

/**
 * Advance the user's recurring-reconcile watermark to `watermark_ms` (the max `updatedAt`
 * of the recurring docs actually processed this run — never past an unprocessed row).
 */
export async function set_recurring_reconcile_watermark_ms(
  user_id: string,
  watermark_ms: number
): Promise<void> {
  await getFirestore()
    .collection(COLLECTION)
    .doc(user_id)
    .set(
      { watermark_ms, updated_at: Timestamp.now() },
      { merge: true }
    );
}
