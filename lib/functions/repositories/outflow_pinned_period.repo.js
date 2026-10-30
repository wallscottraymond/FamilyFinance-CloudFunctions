"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.outflow_pinned_period_repo = exports.outflow_pinned_period_doc_id = exports.OUTFLOW_PINNED_PERIODS_COLLECTION = void 0;
const firestore_1 = require("firebase-admin/firestore");
exports.OUTFLOW_PINNED_PERIODS_COLLECTION = "outflow_pinned_periods";
const outflow_pinned_period_doc_id = (owner_id, outflow_id) => `${owner_id}__${outflow_id}`;
exports.outflow_pinned_period_doc_id = outflow_pinned_period_doc_id;
exports.outflow_pinned_period_repo = {
    /** Bill id → its pinned period ids, for one owner (usually no docs: one read). */
    async get_by_owner(_ctx, owner_id) {
        var _a;
        const snap = await (0, firestore_1.getFirestore)()
            .collection(exports.OUTFLOW_PINNED_PERIODS_COLLECTION)
            .where("ownerId", "==", owner_id)
            .select("outflowId", "periodIds")
            .get();
        const out = new Map();
        for (const d of snap.docs) {
            const id = d.get("outflowId");
            if (id)
                out.set(id, (_a = d.get("periodIds")) !== null && _a !== void 0 ? _a : []);
        }
        return out;
    },
};
//# sourceMappingURL=outflow_pinned_period.repo.js.map