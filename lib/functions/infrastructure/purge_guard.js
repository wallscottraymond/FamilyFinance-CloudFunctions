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
exports.PURGE_STALE_AFTER_MS = exports.PURGE_STATUS_COLLECTION = void 0;
exports.is_user_purging = is_user_purging;
exports.set_purge_status = set_purge_status;
exports.purge_blocks_jobs = purge_blocks_jobs;
exports.purge_guarded_user = purge_guarded_user;
exports.is_job_for_purging_user = is_job_for_purging_user;
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
/**
 * How long a `requested` / `running` purge may go without a status write before it counts as dead
 * for the job guard. A live run writes progress at least per step and is killed at the 9-minute
 * job timeout; a dead one is reclaimed and retried by the sweep after 15 minutes (+ up to 5 for
 * the sweep), which stamps it fresh again. So past this window nothing is purging.
 */
exports.PURGE_STALE_AFTER_MS = 30 * 60 * 1000;
/**
 * Does this purge status make a user's queued jobs no-ops? `done` always (the account is gone);
 * `requested` / `running` while alive (batch 10 verify L7: a purge that died must not silently
 * swallow the user's jobs forever); `blocked` / `failed` never. PURE.
 */
function purge_blocks_jobs(state, updated_at_ms, now_ms) {
    if (state === "done")
        return true;
    if (state !== "requested" && state !== "running")
        return false;
    return updated_at_ms === null || now_ms - updated_at_ms <= exports.PURGE_STALE_AFTER_MS;
}
/**
 * The person a queued job works for, when the purge guard applies to it (Code-Health-Review
 * S1-M6). Every user job carries `payload.user_id`; the purge job itself and system / group-view
 * jobs (no uid, or a "group:<id>" owner key) are never guarded. PURE.
 */
function purge_guarded_user(job_type, payload) {
    if (job_type === "purge_user_data")
        return null;
    const uid = payload === null || payload === void 0 ? void 0 : payload.user_id;
    return typeof uid === "string" && uid.length > 0 && !uid.startsWith("group:") ? uid : null;
}
/**
 * True when a claimed job is for a user who is being (or has been) erased: the runner completes
 * it as a no-op instead of running it against a half-purged account. Covers jobs queued AFTER
 * the purge cancelled the user's pending ones (its own sharing release re-assigns, transfer
 * re-classifies, budget returns; triggers firing on its deletes). One doc read per user job.
 * A purge that died stops counting after PURGE_STALE_AFTER_MS.
 */
async function is_job_for_purging_user(job_type, payload) {
    var _a, _b;
    const uid = purge_guarded_user(job_type, payload);
    if (!uid)
        return false;
    const doc = await (0, firestore_1.getFirestore)().collection(exports.PURGE_STATUS_COLLECTION).doc(uid).get();
    if (!doc.exists)
        return false;
    const status = doc.data();
    return purge_blocks_jobs(status.state, (_b = (_a = status.updated_at) === null || _a === void 0 ? void 0 : _a.toMillis()) !== null && _b !== void 0 ? _b : null, Date.now());
}
//# sourceMappingURL=purge_guard.js.map