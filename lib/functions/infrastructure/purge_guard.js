"use strict";
/**
 * Purge Guard + Status
 *
 * Shared home for the `purge_status/{uid}` doc: its shape, the guard read
 * (`is_user_purging`) that background paths (Plaid sync, webhooks) check to avoid
 * re-populating a user who is being erased, and a small upsert helper.
 *
 * Kept in `infrastructure` (not a repository) because the guard read is called
 * from entry/orchestrator layers that must NOT depend on the full repo surface,
 * and it is a single-doc read/write with no domain logic.
 *
 * @module infrastructure/purge_guard
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PURGE_STATUS_COLLECTION = void 0;
exports.is_user_purging = is_user_purging;
exports.set_purge_status = set_purge_status;
const firestore_1 = require("firebase-admin/firestore");
/** The per-user purge status doc lives at `purge_status/{uid}`. */
exports.PURGE_STATUS_COLLECTION = "purge_status";
/**
 * Whether a user is mid- or post-purge, so background writers should abort.
 *
 * True for `requested | running | done` — i.e. once a purge is in flight or has
 * completed, nothing should recreate the user's data. `blocked`/`failed` do NOT
 * block (the purge didn't run / can be retried).
 */
async function is_user_purging(user_id) {
    const doc = await (0, firestore_1.getFirestore)()
        .collection(exports.PURGE_STATUS_COLLECTION)
        .doc(user_id)
        .get();
    if (!doc.exists) {
        return false;
    }
    const state = doc.data().state;
    return state === "requested" || state === "running" || state === "done";
}
/**
 * Upsert a patch onto `purge_status/{uid}` (always stamps `updated_at`).
 * Merge-write so partial progress updates don't clobber prior fields.
 */
async function set_purge_status(user_id, patch) {
    await (0, firestore_1.getFirestore)()
        .collection(exports.PURGE_STATUS_COLLECTION)
        .doc(user_id)
        .set(Object.assign({ user_id, updated_at: firestore_1.Timestamp.now() }, patch), { merge: true });
}
//# sourceMappingURL=purge_guard.js.map