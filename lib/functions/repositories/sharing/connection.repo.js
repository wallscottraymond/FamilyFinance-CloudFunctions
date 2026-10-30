"use strict";
/**
 * Connection Repository (D24, D27)
 *
 * `connections/{pairId}` where pairId = the two uids sorted, joined by "__".
 * Functions-only. Queried by `userIds array-contains`.
 *
 * @module repositories/sharing/connection
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.connection_repo = void 0;
const firestore_1 = require("firebase-admin/firestore");
const COLLECTION = "connections";
/** gRPC status for create() on an existing doc. */
const ALREADY_EXISTS = 6;
/* eslint-enable @typescript-eslint/naming-convention */
function to_domain(id, doc) {
    var _a, _b;
    return {
        id,
        user_ids: doc.userIds,
        status: doc.status,
        connected_at_ms: doc.connectedAt.toMillis(),
        blocked_by: (_a = doc.blockedBy) !== null && _a !== void 0 ? _a : null,
        nicknames: (_b = doc.nicknames) !== null && _b !== void 0 ? _b : {},
    };
}
function to_doc(entity, now_ms) {
    /* eslint-disable @typescript-eslint/naming-convention */
    return {
        userIds: entity.user_ids,
        status: entity.status,
        connectedAt: firestore_1.Timestamp.fromMillis(entity.connected_at_ms),
        blockedBy: entity.blocked_by,
        nicknames: entity.nicknames,
        updatedAt: firestore_1.Timestamp.fromMillis(now_ms),
    };
    /* eslint-enable @typescript-eslint/naming-convention */
}
const ref = (id) => (0, firestore_1.getFirestore)().collection(COLLECTION).doc(id);
exports.connection_repo = {
    async get(_ctx, pair_id) {
        const snap = await ref(pair_id).get();
        return snap.exists ? to_domain(snap.id, snap.data()) : null;
    },
    /** All of a user's connection docs (connected and blocked). Max ~10 + blocks. */
    async get_for_user(_ctx, user_id) {
        const snap = await (0, firestore_1.getFirestore)()
            .collection(COLLECTION)
            .where("userIds", "array-contains", user_id)
            .get();
        return snap.docs.map((d) => to_domain(d.id, d.data()));
    },
    /** Number of active (not blocked) connections for a user. */
    async count_connected(_ctx, user_id) {
        const snap = await (0, firestore_1.getFirestore)()
            .collection(COLLECTION)
            .where("userIds", "array-contains", user_id)
            .where("status", "==", "connected")
            .count()
            .get();
        return snap.data().count;
    },
    async save(_ctx, entity, now_ms) {
        await ref(entity.id).set(to_doc(entity, now_ms));
    },
    /** Creates the connection unless the pair's doc already exists (two sides connecting at once). */
    async create_if_absent(_ctx, entity, now_ms) {
        try {
            await ref(entity.id).create(to_doc(entity, now_ms));
        }
        catch (e) {
            if (e.code !== ALREADY_EXISTS)
                throw e;
        }
    },
    async delete(_ctx, pair_id) {
        await ref(pair_id).delete();
    },
};
//# sourceMappingURL=connection.repo.js.map