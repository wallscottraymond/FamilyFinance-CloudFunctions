/**
 * Outflow Pinned Periods — which periods a bill has a hand-pinned payment in.
 *
 * The period page (derive) loads only the payments dated in the period it shows, so a payment the
 * user pinned to ANOTHER period with the bill picker (`outflowPinnedPeriodId`: a late payment of an
 * overdue month, or one paid ahead) is found only through this list.
 *
 * One doc per (owner, bill), id `${owner_id}__${outflow_id}` (purge sweeps the `${uid}__` prefix):
 * `{ ownerId, outflowId, periodIds[] }`. Its own collection — NOT a field on the bill — because the
 * bill is rebuilt by full-document writes (Plaid sync) that would drop a pin made between their read
 * and their write. The ONLY writer is `transaction_repo.pin_split_to_outflow` (arrayUnion, in its
 * transaction). Never pruned: one id per distinct pinned period, and a stale id (an un-pin) costs
 * the period page one query for that bill, nothing else. Server-only (rules' catch-all denies it).
 *
 * @module repositories/outflow_pinned_period
 */

import { getFirestore } from "firebase-admin/firestore";
import { TraceContext } from "../types";

export const OUTFLOW_PINNED_PERIODS_COLLECTION = "outflow_pinned_periods";

export const outflow_pinned_period_doc_id = (owner_id: string, outflow_id: string): string =>
  `${owner_id}__${outflow_id}`;

export const outflow_pinned_period_repo = {
  /** Bill id → its pinned period ids, for one owner (usually no docs: one read). */
  async get_by_owner(_ctx: TraceContext, owner_id: string): Promise<Map<string, string[]>> {
    const snap = await getFirestore()
      .collection(OUTFLOW_PINNED_PERIODS_COLLECTION)
      .where("ownerId", "==", owner_id)
      .select("outflowId", "periodIds")
      .get();
    const out = new Map<string, string[]>();
    for (const d of snap.docs) {
      const id = d.get("outflowId") as string | undefined;
      if (id) out.set(id, (d.get("periodIds") as string[] | undefined) ?? []);
    }
    return out;
  },
};
