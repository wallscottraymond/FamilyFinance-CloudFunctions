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

import { getFirestore, Timestamp } from "firebase-admin/firestore";

const COLLECTION = "_assignment_watermarks";

/**
 * Read the user's assignment watermark (epoch ms), or `null` if none yet.
 */
export async function get_assignment_watermark_ms(
  user_id: string
): Promise<number | null> {
  const snap = await getFirestore().collection(COLLECTION).doc(user_id).get();
  if (!snap.exists) return null;
  const ms = snap.data()?.watermark_ms;
  return typeof ms === "number" ? ms : null;
}

/**
 * Advance the user's assignment watermark to `watermark_ms`. Called ONLY after a successful batch
 * so a failed/retried run re-processes from the old cursor (never strands unassigned txns).
 */
export async function set_assignment_watermark_ms(
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
