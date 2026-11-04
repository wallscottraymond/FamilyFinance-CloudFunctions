"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitlist_repo = exports.WAITLIST_LIMITS_COLLECTION = exports.WAITLIST_COLLECTION = void 0;
const firestore_1 = require("firebase-admin/firestore");
exports.WAITLIST_COLLECTION = "waitlist";
exports.WAITLIST_LIMITS_COLLECTION = "_waitlist_limits";
const GLOBAL_LIMIT_ID = "global";
function doc_to_counter(d) {
    if (!d || typeof d.day !== "string" || typeof d.count !== "number")
        return null;
    return { day: d.day, count: d.count };
}
exports.waitlist_repo = {
    /** Reads the entry and both counters, plans, and writes the plan atomically. */
    async join_in_transaction(_ctx, id, ip_limit_id, plan) {
        if (!id || !ip_limit_id)
            throw new Error("join_in_transaction requires both ids");
        const db = (0, firestore_1.getFirestore)();
        const entry_ref = db.collection(exports.WAITLIST_COLLECTION).doc(id);
        const ip_ref = db.collection(exports.WAITLIST_LIMITS_COLLECTION).doc(ip_limit_id);
        const global_ref = db.collection(exports.WAITLIST_LIMITS_COLLECTION).doc(GLOBAL_LIMIT_ID);
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
                    createdAt: firestore_1.Timestamp.fromMillis(planned.entry.created_at_ms),
                });
            }
            if (planned.ip_counter) {
                tx.set(ip_ref, Object.assign(Object.assign({}, planned.ip_counter), { expire_at: firestore_1.Timestamp.fromMillis(planned.limit_expires_at_ms) }));
            }
            if (planned.global_counter)
                tx.set(global_ref, planned.global_counter);
            /* eslint-enable @typescript-eslint/naming-convention */
            return planned;
        });
    },
};
//# sourceMappingURL=waitlist.repo.js.map