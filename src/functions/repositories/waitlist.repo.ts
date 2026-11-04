/**
 * Waitlist Repository (Website-Waitlist)
 *
 * - `waitlist/{sha256(email)}`: one person waiting.
 * - `_waitlist_limits/{sha256(day:ip)}`: one network's requests today (TTL on `expire_at`).
 * - `_waitlist_limits/global`: new signups today (kept, overwritten daily).
 *
 * Functions-only: the rules deny every client read and write.
 *
 * @module repositories/waitlist
 */

import { DocumentData, getFirestore, Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../types";
import { JoinState, JoinPlan } from "../domain/waitlist/waitlist.service";
import { WaitlistDayCounter } from "../types/waitlist.types";

export const WAITLIST_COLLECTION = "waitlist";
export const WAITLIST_LIMITS_COLLECTION = "_waitlist_limits";
const GLOBAL_LIMIT_ID = "global";

function doc_to_counter(d: DocumentData | undefined): WaitlistDayCounter | null {
  if (!d || typeof d.day !== "string" || typeof d.count !== "number") return null;
  return { day: d.day, count: d.count };
}

export const waitlist_repo = {
  /** Reads the entry and both counters, plans, and writes the plan atomically. */
  async join_in_transaction(
    _ctx: TraceContext,
    id: string,
    ip_limit_id: string,
    plan: (state: JoinState) => JoinPlan
  ): Promise<JoinPlan> {
    if (!id || !ip_limit_id) throw new Error("join_in_transaction requires both ids");
    const db = getFirestore();
    const entry_ref = db.collection(WAITLIST_COLLECTION).doc(id);
    const ip_ref = db.collection(WAITLIST_LIMITS_COLLECTION).doc(ip_limit_id);
    const global_ref = db.collection(WAITLIST_LIMITS_COLLECTION).doc(GLOBAL_LIMIT_ID);

    return db.runTransaction(async (tx) => {
      const [entry_snap, ip_snap, global_snap] = await tx.getAll(entry_ref, ip_ref, global_ref);
      const planned = plan({
        entry_exists: entry_snap.exists,
        ip_counter: doc_to_counter(ip_snap.data()),
        global_counter: doc_to_counter(global_snap.data()),
      });
      /* eslint-disable @typescript-eslint/naming-convention */
      if (planned.entry) {
        tx.create(entry_ref, {
          email: planned.entry.email,
          source: planned.entry.source,
          status: "waiting",
          createdAt: Timestamp.fromMillis(planned.entry.created_at_ms),
        });
      }
      if (planned.ip_counter) {
        tx.set(ip_ref, {
          ...planned.ip_counter,
          expire_at: Timestamp.fromMillis(planned.limit_expires_at_ms),
        });
      }
      if (planned.global_counter) tx.set(global_ref, planned.global_counter);
      /* eslint-enable @typescript-eslint/naming-convention */
      return planned;
    });
  },
};
