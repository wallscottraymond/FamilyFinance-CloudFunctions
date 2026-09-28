/**
 * Transfer-Classification State Repository
 *
 * Per user, the fingerprint of the recurring records the internal-transfer classifier last
 * ran over, and when. Lets `classify_internal_transfers` SKIP its 180-day transaction scan
 * (~3K reads) when nothing it classifies has changed — it used to run after EVERY per-item
 * recurring sync (4 cycles/day × N Plaid items), re-deriving the same answer.
 *
 * Server-only (falls under the rules' deny-all catch-all). 1 read per classify call,
 * 1 write per full run. Holds only a hash + timestamp (no user data).
 *
 * @module repositories/transfer_classification_state
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";

const COLLECTION = "_transfer_classification_state";

export interface TransferClassificationState {
  fingerprint: string;
  classified_at_ms: number;
}

/** The user's last classification state, or `null` if never classified. 1 read. */
export async function get_transfer_classification_state(
  user_id: string
): Promise<TransferClassificationState | null> {
  const snap = await getFirestore().collection(COLLECTION).doc(user_id).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  if (typeof data.fingerprint !== "string" || typeof data.classified_at_ms !== "number") {
    return null;
  }
  return { fingerprint: data.fingerprint, classified_at_ms: data.classified_at_ms };
}

/** Record a completed full classification. 1 write. */
export async function set_transfer_classification_state(
  user_id: string,
  state: TransferClassificationState
): Promise<void> {
  await getFirestore()
    .collection(COLLECTION)
    .doc(user_id)
    .set({ ...state, updated_at: Timestamp.now() });
}
