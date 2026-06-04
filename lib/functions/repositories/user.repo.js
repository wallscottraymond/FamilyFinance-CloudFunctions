"use strict";
/**
 * User Repository
 *
 * READ-ONLY persistence boundary for the `users` collection. Currently only
 * exposes the enumeration the assignment backfill needs (all user doc IDs).
 *
 * @module repositories/user
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.user_repo = void 0;
const firestore_1 = require("firebase-admin/firestore");
const COLLECTION = "users";
exports.user_repo = {
    /**
     * Enumerate all user IDs (doc IDs of the `users` collection). Uses a
     * field-mask `select()` so only document refs are read, not full bodies.
     */
    async get_all_ids(ctx) {
        const snapshot = await (0, firestore_1.getFirestore)().collection(COLLECTION).select().get();
        const ids = snapshot.docs.map((doc) => doc.id);
        console.log(`[${ctx.trace_id}] user_repo.get_all_ids: found=${ids.length}`);
        return ids;
    },
};
//# sourceMappingURL=user.repo.js.map