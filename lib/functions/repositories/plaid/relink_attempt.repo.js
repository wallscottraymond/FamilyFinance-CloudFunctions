"use strict";
/**
 * Relink Attempt Repository
 *
 * Handles persistence for relink attempt tracking.
 * Used to track re-authentication attempts and their outcomes.
 *
 * @module repositories/plaid/relink_attempt
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.relink_attempt_repo = void 0;
const firestore_1 = require("firebase-admin/firestore");
const update_link_token_types_1 = require("../../types/plaid/update_link_token.types");
/**
 * Firestore collection name.
 */
const COLLECTION = "relink_attempts";
/**
 * Gets the Firestore instance.
 */
function get_db() {
    return (0, firestore_1.getFirestore)();
}
/**
 * Gets a document reference.
 */
function doc_ref(id) {
    return get_db().collection(COLLECTION).doc(id);
}
/**
 * Relink Attempt Repository
 *
 * Provides methods for CRUD operations on relink attempts.
 */
exports.relink_attempt_repo = {
    /**
     * Creates a new relink attempt record.
     *
     * @param ctx - Trace context
     * @param input - Relink attempt data
     * @returns The created document ID
     */
    async create(ctx, input) {
        const db = get_db();
        const doc = db.collection(COLLECTION).doc();
        const attempt = Object.assign(Object.assign({ id: doc.id }, input), { created_at: firestore_1.Timestamp.now(), completed_at: null });
        await doc.set(attempt);
        console.log(`[${ctx.trace_id}] Created relink attempt ${doc.id} for item ${input.item_id}`);
        return doc.id;
    },
    /**
     * Marks a relink attempt as completed.
     *
     * @param ctx - Trace context
     * @param attempt_id - The attempt document ID
     * @param success - Whether the relink was successful
     */
    async mark_completed(ctx, attempt_id, success) {
        await doc_ref(attempt_id).update({
            success,
            completed_at: firestore_1.FieldValue.serverTimestamp(),
        });
        console.log(`[${ctx.trace_id}] Marked relink attempt ${attempt_id} as ${success ? "successful" : "failed"}`);
    },
    /**
     * Marks all pending relink attempts for an item as successful.
     * Called when LOGIN_REPAIRED webhook is received.
     *
     * @param ctx - Trace context
     * @param item_id - The Plaid item document ID
     */
    async mark_all_successful_for_item(ctx, item_id) {
        const db = get_db();
        // Find all pending attempts for this item
        const pending_snapshot = await db
            .collection(COLLECTION)
            .where("item_id", "==", item_id)
            .where("success", "==", null)
            .get();
        if (pending_snapshot.empty) {
            return 0;
        }
        // Update all in batch
        const batch = db.batch();
        const now = firestore_1.FieldValue.serverTimestamp();
        for (const doc of pending_snapshot.docs) {
            batch.update(doc.ref, {
                success: true,
                completed_at: now,
            });
        }
        await batch.commit();
        console.log(`[${ctx.trace_id}] Marked ${pending_snapshot.size} relink attempts as successful for item ${item_id}`);
        return pending_snapshot.size;
    },
    /**
     * Counts recent relink attempts for an item.
     *
     * @param ctx - Trace context
     * @param user_id - User ID
     * @param item_id - Item document ID
     * @returns Number of attempts in the window
     */
    async count_recent(ctx, user_id, item_id) {
        const db = get_db();
        const window_start = firestore_1.Timestamp.fromDate(new Date(Date.now() - update_link_token_types_1.RELINK_ATTEMPT_WINDOW_HOURS * 60 * 60 * 1000));
        const snapshot = await db
            .collection(COLLECTION)
            .where("user_id", "==", user_id)
            .where("item_id", "==", item_id)
            .where("created_at", ">=", window_start)
            .get();
        return snapshot.size;
    },
    /**
     * Gets the most recent relink attempt for an item.
     *
     * @param ctx - Trace context
     * @param item_id - Item document ID
     * @returns The most recent attempt or null
     */
    async get_most_recent(ctx, item_id) {
        const db = get_db();
        const snapshot = await db
            .collection(COLLECTION)
            .where("item_id", "==", item_id)
            .orderBy("created_at", "desc")
            .limit(1)
            .get();
        if (snapshot.empty) {
            return null;
        }
        return snapshot.docs[0].data();
    },
    /**
     * Cleans up old relink attempts (for scheduled cleanup).
     *
     * @param ctx - Trace context
     * @param retention_days - Number of days to retain attempts
     * @returns Number of deleted documents
     */
    async cleanup_old_attempts(ctx, retention_days) {
        const db = get_db();
        const cutoff = firestore_1.Timestamp.fromDate(new Date(Date.now() - retention_days * 24 * 60 * 60 * 1000));
        const old_snapshot = await db
            .collection(COLLECTION)
            .where("created_at", "<", cutoff)
            .limit(500) // Batch limit
            .get();
        if (old_snapshot.empty) {
            return 0;
        }
        const batch = db.batch();
        for (const doc of old_snapshot.docs) {
            batch.delete(doc.ref);
        }
        await batch.commit();
        console.log(`[${ctx.trace_id}] Cleaned up ${old_snapshot.size} old relink attempts`);
        return old_snapshot.size;
    },
};
//# sourceMappingURL=relink_attempt.repo.js.map