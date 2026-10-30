"use strict";
/**
 * Connect Code Repository (D24)
 *
 * `connect_codes/{uid}`: the user's current code, who has typed it, and their
 * wrong-code counters. Functions-only (rules deny clients). `expireAt` is a TTL
 * field (policy: delete a day after the code expires).
 *
 * @module repositories/sharing/connect_code
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.connect_code_repo = void 0;
const firestore_1 = require("firebase-admin/firestore");
const COLLECTION = "connect_codes";
const TTL_GRACE_MS = 24 * 60 * 60 * 1000;
/* eslint-enable @typescript-eslint/naming-convention */
function to_domain(doc) {
    var _a, _b, _c;
    return {
        user_id: doc.userId,
        // A doc can exist with only failure counters (no code issued yet).
        code: (_a = doc.code) !== null && _a !== void 0 ? _a : "",
        expires_at_ms: doc.expiresAt ? doc.expiresAt.toMillis() : 0,
        entries: (_b = doc.entries) !== null && _b !== void 0 ? _b : {},
        failed_attempts: (_c = doc.failedAttempts) !== null && _c !== void 0 ? _c : 0,
        cooldown_until_ms: doc.cooldownUntil ? doc.cooldownUntil.toMillis() : 0,
    };
}
function to_doc(entity, now_ms) {
    /* eslint-disable @typescript-eslint/naming-convention */
    return {
        userId: entity.user_id,
        code: entity.code,
        expiresAt: firestore_1.Timestamp.fromMillis(entity.expires_at_ms),
        entries: entity.entries,
        failedAttempts: entity.failed_attempts,
        cooldownUntil: entity.cooldown_until_ms ? firestore_1.Timestamp.fromMillis(entity.cooldown_until_ms) : null,
        expireAt: firestore_1.Timestamp.fromMillis(Math.max(entity.expires_at_ms, entity.cooldown_until_ms) + TTL_GRACE_MS),
        updatedAt: firestore_1.Timestamp.fromMillis(now_ms),
    };
    /* eslint-enable @typescript-eslint/naming-convention */
}
const ref = (user_id) => (0, firestore_1.getFirestore)().collection(COLLECTION).doc(user_id);
exports.connect_code_repo = {
    /** The user's code doc, or null. */
    async get_by_user(_ctx, user_id) {
        const snap = await ref(user_id).get();
        return snap.exists ? to_domain(snap.data()) : null;
    },
    /** Unexpired code docs with this code (normally 0 or 1). */
    async find_active_by_code(_ctx, code, now_ms) {
        const snap = await (0, firestore_1.getFirestore)()
            .collection(COLLECTION)
            .where("code", "==", code)
            .limit(5)
            .get();
        return snap.docs
            .map((d) => to_domain(d.data()))
            .filter((c) => c.expires_at_ms > now_ms);
    },
    /** Replaces the user's code doc. */
    async save(_ctx, entity, now_ms) {
        await ref(entity.user_id).set(to_doc(entity, now_ms));
    },
    /** Records that `entrant_id` typed `owner_id`'s code (idempotent map write). */
    async record_entry(_ctx, owner_id, entrant_id, at_ms) {
        await ref(owner_id).set({ entries: { [entrant_id]: at_ms } }, { merge: true });
    },
    /** Sets the wrong-code counters for a user (creates the doc if needed). */
    async set_failure_state(_ctx, user_id, failed_attempts, cooldown_until_ms, now_ms) {
        /* eslint-disable @typescript-eslint/naming-convention */
        await ref(user_id).set({
            userId: user_id,
            failedAttempts: failed_attempts,
            cooldownUntil: cooldown_until_ms ? firestore_1.Timestamp.fromMillis(cooldown_until_ms) : null,
            expireAt: firestore_1.Timestamp.fromMillis(Math.max(now_ms, cooldown_until_ms) + TTL_GRACE_MS),
            updatedAt: firestore_1.Timestamp.fromMillis(now_ms),
        }, { merge: true });
        /* eslint-enable @typescript-eslint/naming-convention */
    },
    /** Removes the user's code doc (account purge). */
    async delete(_ctx, user_id) {
        await ref(user_id).delete();
    },
    /** Expires both people's codes once they've connected (codes are single-use). */
    async expire_codes(_ctx, user_ids, now_ms) {
        const batch = (0, firestore_1.getFirestore)().batch();
        for (const uid of user_ids) {
            // update (not merge-set): a merged `entries: {}` would keep the old keys.
            batch.update(ref(uid), {
                /* eslint-disable-next-line @typescript-eslint/naming-convention */
                expiresAt: firestore_1.Timestamp.fromMillis(now_ms),
                entries: {},
                /* eslint-disable-next-line @typescript-eslint/naming-convention */
                failedAttempts: 0,
            });
        }
        await batch.commit();
    },
};
//# sourceMappingURL=connect_code.repo.js.map