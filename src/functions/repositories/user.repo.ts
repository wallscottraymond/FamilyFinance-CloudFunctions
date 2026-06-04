/**
 * User Repository
 *
 * READ-ONLY persistence boundary for the `users` collection. Currently only
 * exposes the enumeration the assignment backfill needs (all user doc IDs).
 *
 * @module repositories/user
 */

import { getFirestore } from "firebase-admin/firestore";
import { TraceContext } from "../types";

const COLLECTION = "users";

export const user_repo = {
  /**
   * Enumerate all user IDs (doc IDs of the `users` collection). Uses a
   * field-mask `select()` so only document refs are read, not full bodies.
   */
  async get_all_ids(ctx: TraceContext): Promise<string[]> {
    const snapshot = await getFirestore().collection(COLLECTION).select().get();
    const ids = snapshot.docs.map((doc) => doc.id);
    console.log(`[${ctx.trace_id}] user_repo.get_all_ids: found=${ids.length}`);
    return ids;
  },
};
