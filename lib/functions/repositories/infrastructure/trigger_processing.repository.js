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
const firestore_1 = require("firebase-admin/firestore");
/**
 * Collection name for trigger processing records.
 */
const COLLECTION = "_trigger_processing";
/** How long a trigger dedup record is retained (TTL) — well beyond the replay window. */
const TRIGGER_DEDUP_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
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
    const now_ms = Date.now();
    const record = {
        key,
        document_id,
        event_id,
        processed_at: firestore_1.Timestamp.fromMillis(now_ms),
        // TTL: dedup guards only matter for the trigger-replay window (minutes-hours). Keep 2 days
        // of headroom, then Firestore auto-deletes them (no cleanup-cron reads).
        expire_at: firestore_1.Timestamp.fromMillis(now_ms + TRIGGER_DEDUP_RETENTION_MS),
        trace_id: ctx.trace_id,
    };
    await db.collection(COLLECTION).doc(key).set(record);
}
//# sourceMappingURL=trigger_processing.repository.js.map