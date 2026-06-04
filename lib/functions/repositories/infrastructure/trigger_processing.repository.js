"use strict";
/**
 * Trigger Processing Repository
 *
 * Repository layer for trigger processing record operations.
 * Handles all Firestore access for the _trigger_processing collection.
 *
 * @module repository/infrastructure/trigger_processing
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.delete_old_records = delete_old_records;
exports.is_processed = is_processed;
exports.mark_processed = mark_processed;
exports.get_record_count = get_record_count;
const firestore_1 = require("firebase-admin/firestore");
/**
 * Collection name for trigger processing records.
 */
const COLLECTION = "_trigger_processing";
/**
 * Deletes old trigger processing records.
 *
 * @param ctx - Trace context
 * @param cutoff - Delete records older than this timestamp
 * @param batch_size - Maximum records to delete per batch
 * @returns Count of deleted records
 */
async function delete_old_records(ctx, cutoff, batch_size) {
    const db = (0, firestore_1.getFirestore)();
    const old_docs = await db
        .collection(COLLECTION)
        .where("processed_at", "<", cutoff)
        .limit(batch_size)
        .get();
    if (old_docs.empty) {
        return { deleted_count: 0 };
    }
    const batch = db.batch();
    old_docs.docs.forEach((doc) => {
        batch.delete(doc.ref);
    });
    await batch.commit();
    return { deleted_count: old_docs.size };
}
/**
 * Checks if a trigger has already been processed.
 *
 * @param ctx - Trace context
 * @param key - Trigger processing key
 * @returns true if already processed
 */
async function is_processed(ctx, key) {
    const db = (0, firestore_1.getFirestore)();
    const doc = await db.collection(COLLECTION).doc(key).get();
    return doc.exists;
}
/**
 * Marks a trigger as processed.
 *
 * @param ctx - Trace context
 * @param key - Trigger processing key
 * @param document_id - Document ID that triggered the event
 * @param event_id - Firebase event ID
 */
async function mark_processed(ctx, key, document_id, event_id) {
    const db = (0, firestore_1.getFirestore)();
    const record = {
        key,
        document_id,
        event_id,
        processed_at: firestore_1.Timestamp.now(),
        trace_id: ctx.trace_id,
    };
    await db.collection(COLLECTION).doc(key).set(record);
}
/**
 * Gets count of trigger processing records.
 *
 * @param ctx - Trace context
 * @returns Count of records
 */
async function get_record_count(_ctx) {
    const db = (0, firestore_1.getFirestore)();
    const result = await db.collection(COLLECTION).count().get();
    return result.data().count;
}
//# sourceMappingURL=trigger_processing.repository.js.map