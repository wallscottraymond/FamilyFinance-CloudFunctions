"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.item_sync_lease_repo = exports.SYNC_LEASE_TTL_MS = void 0;
const firestore_1 = require("firebase-admin/firestore");
const COLLECTION = "_item_sync_leases";
/** Longer than a sync can run (the job function's timeout is 540 s), so a crash self-heals. */
exports.SYNC_LEASE_TTL_MS = 10 * 60 * 1000;
exports.item_sync_lease_repo = {
    /**
     * Try to take the lease for `run_id`. False = another sync holds it; the request has been
     * recorded on the lease so the holder runs again.
     */
    async claim(item_doc_id, run_id, request) {
        const db = (0, firestore_1.getFirestore)();
        const ref = db.collection(COLLECTION).doc(item_doc_id);
        return db.runTransaction(async (tx) => {
            var _a, _b;
            const snap = await tx.get(ref);
            const d = snap.exists ? snap.data() : {};
            const until = (_b = (_a = d.lease_until) === null || _a === void 0 ? void 0 : _a.toMillis()) !== null && _b !== void 0 ? _b : 0;
            const now = Date.now();
            if (until > now && d.run_id_holder !== run_id) {
                tx.set(ref, { requested: true, requested_recurring: !!d.requested_recurring || !!request.recurring }, { merge: true });
                return false;
            }
            tx.set(ref, {
                run_id_holder: run_id,
                lease_until: firestore_1.Timestamp.fromMillis(now + exports.SYNC_LEASE_TTL_MS),
                requested: false,
                requested_recurring: false,
                claimed_at: firestore_1.Timestamp.fromMillis(now),
            });
            return true;
        });
    },
    /**
     * End a round. If another request came in meanwhile, keep the lease (renewed) and return the
     * request so the holder runs again; otherwise release and return null.
     */
    async finish_round(item_doc_id, run_id) {
        const db = (0, firestore_1.getFirestore)();
        const ref = db.collection(COLLECTION).doc(item_doc_id);
        return db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const d = snap.exists ? snap.data() : {};
            if (d.run_id_holder !== run_id)
                return null; // lease expired and was taken over — stop
            if (d.requested) {
                tx.update(ref, {
                    requested: false,
                    requested_recurring: false,
                    lease_until: firestore_1.Timestamp.fromMillis(Date.now() + exports.SYNC_LEASE_TTL_MS),
                });
                return { recurring: !!d.requested_recurring };
            }
            tx.update(ref, { lease_until: null, run_id_holder: null });
            return null;
        });
    },
    /** Release after a failure (the next request starts a fresh sync). */
    async release(item_doc_id, run_id) {
        const db = (0, firestore_1.getFirestore)();
        const ref = db.collection(COLLECTION).doc(item_doc_id);
        await db.runTransaction(async (tx) => {
            var _a;
            const snap = await tx.get(ref);
            if (snap.exists && ((_a = snap.data()) === null || _a === void 0 ? void 0 : _a.run_id_holder) === run_id) {
                tx.update(ref, { lease_until: null, run_id_holder: null });
            }
        });
    },
};
//# sourceMappingURL=item_sync_lease.repo.js.map