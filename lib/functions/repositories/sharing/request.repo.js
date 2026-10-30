"use strict";
/**
 * Request Repository (D25, D26)
 *
 * `requests/{id}`: offers waiting for the recipient's Accept. Functions-only.
 * `expireAt` is a TTL field (30 days after the request expires).
 *
 * Indexes: (toUserId, status), (fromUserId, createdAt), (groupId, status),
 * (targetId, status).
 *
 * @module repositories/sharing/request
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.request_repo = void 0;
const firestore_1 = require("firebase-admin/firestore");
const COLLECTION = "requests";
const TTL_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
/* eslint-enable @typescript-eslint/naming-convention */
function to_domain(id, doc) {
    var _a, _b;
    return {
        id,
        type: doc.type,
        from_user_id: doc.fromUserId,
        to_user_id: doc.toUserId,
        group_id: doc.groupId,
        target_id: (_a = doc.targetId) !== null && _a !== void 0 ? _a : null,
        target_label: (_b = doc.targetLabel) !== null && _b !== void 0 ? _b : null,
        shared_from_ms: doc.sharedFrom ? doc.sharedFrom.toMillis() : null,
        status: doc.status,
        created_at_ms: doc.createdAt.toMillis(),
        expires_at_ms: doc.expiresAt.toMillis(),
        responded_at_ms: doc.respondedAt ? doc.respondedAt.toMillis() : null,
    };
}
function to_doc(entity) {
    /* eslint-disable @typescript-eslint/naming-convention */
    return {
        type: entity.type,
        fromUserId: entity.from_user_id,
        toUserId: entity.to_user_id,
        groupId: entity.group_id,
        targetId: entity.target_id,
        targetLabel: entity.target_label,
        sharedFrom: entity.shared_from_ms !== null ? firestore_1.Timestamp.fromMillis(entity.shared_from_ms) : null,
        status: entity.status,
        createdAt: firestore_1.Timestamp.fromMillis(entity.created_at_ms),
        expiresAt: firestore_1.Timestamp.fromMillis(entity.expires_at_ms),
        respondedAt: entity.responded_at_ms ? firestore_1.Timestamp.fromMillis(entity.responded_at_ms) : null,
        expireAt: firestore_1.Timestamp.fromMillis(entity.expires_at_ms + TTL_GRACE_MS),
    };
    /* eslint-enable @typescript-eslint/naming-convention */
}
const collection = () => (0, firestore_1.getFirestore)().collection(COLLECTION);
exports.request_repo = {
    /** A new doc id (domain builds the entity with it). */
    new_id() {
        return collection().doc().id;
    },
    async get(_ctx, id) {
        const snap = await collection().doc(id).get();
        return snap.exists ? to_domain(snap.id, snap.data()) : null;
    },
    /** Pending requests addressed to a user. */
    async get_pending_for_recipient(_ctx, user_id) {
        const snap = await collection()
            .where("toUserId", "==", user_id)
            .where("status", "==", "pending")
            .limit(100)
            .get();
        return snap.docs.map((d) => to_domain(d.id, d.data()));
    },
    /** Requests a sender created since `since_ms` (for the daily limit). */
    async get_sent_since(_ctx, user_id, since_ms) {
        const snap = await collection()
            .where("fromUserId", "==", user_id)
            .where("createdAt", ">=", firestore_1.Timestamp.fromMillis(since_ms))
            .limit(200)
            .get();
        return snap.docs.map((d) => to_domain(d.id, d.data()));
    },
    /** Pending requests for a group (to cancel them when the group goes away). */
    async get_pending_for_group(_ctx, group_id) {
        const snap = await collection()
            .where("groupId", "==", group_id)
            .where("status", "==", "pending")
            .limit(500)
            .get();
        return snap.docs.map((d) => to_domain(d.id, d.data()));
    },
    /** Pending requests about one account (share_account). */
    async get_pending_for_target(_ctx, target_id) {
        const snap = await collection()
            .where("targetId", "==", target_id)
            .where("status", "==", "pending")
            .limit(100)
            .get();
        return snap.docs.map((d) => to_domain(d.id, d.data()));
    },
    /** Writes requests in one batch. */
    async save_many(_ctx, entities) {
        if (entities.length === 0)
            return;
        const batch = (0, firestore_1.getFirestore)().batch();
        for (const e of entities)
            batch.set(collection().doc(e.id), to_doc(e));
        await batch.commit();
    },
    /** Writes a request inside a caller's transaction. */
    set_in_transaction(tx, entity) {
        tx.set(collection().doc(entity.id), to_doc(entity));
    },
};
//# sourceMappingURL=request.repo.js.map