"use strict";
/**
 * Logs Repository
 *
 * Repository layer for log record operations.
 * Handles all Firestore access for _logs_minimal, _logs_debug, and _traces.
 *
 * @module repository/infrastructure/logs
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOG_COLLECTIONS = void 0;
exports.delete_old_records = delete_old_records;
exports.get_record_count = get_record_count;
exports.write_minimal_log = write_minimal_log;
exports.write_debug_log = write_debug_log;
exports.write_trace_summary = write_trace_summary;
const firestore_1 = require("firebase-admin/firestore");
/**
 * Collection names for logs.
 */
exports.LOG_COLLECTIONS = {
    MINIMAL: "_logs_minimal",
    DEBUG: "_logs_debug",
    TRACES: "_traces",
};
/**
 * Deletes old log records from a collection.
 *
 * @param ctx - Trace context
 * @param collection - Collection name
 * @param cutoff - Delete records older than this timestamp
 * @param batch_size - Maximum records to delete per batch
 * @returns Count of deleted records
 */
async function delete_old_records(ctx, collection, cutoff, batch_size) {
    const db = (0, firestore_1.getFirestore)();
    const old_docs = await db
        .collection(collection)
        .where("timestamp", "<", cutoff)
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
 * Gets count of records in a log collection.
 *
 * @param ctx - Trace context
 * @param collection - Collection name
 * @returns Count of records
 */
async function get_record_count(ctx, collection) {
    const db = (0, firestore_1.getFirestore)();
    const result = await db.collection(collection).count().get();
    return result.data().count;
}
/**
 * Writes a minimal log entry.
 *
 * @param ctx - Trace context
 * @param entry - Log entry data
 * @returns The created document ID
 */
async function write_minimal_log(ctx, entry) {
    const db = (0, firestore_1.getFirestore)();
    const doc_ref = await db.collection(exports.LOG_COLLECTIONS.MINIMAL).add(Object.assign(Object.assign({}, entry), { timestamp: firestore_1.Timestamp.now() }));
    return doc_ref.id;
}
/**
 * Writes a debug log entry.
 *
 * @param ctx - Trace context
 * @param entry - Log entry data
 * @returns The created document ID
 */
async function write_debug_log(ctx, entry) {
    const db = (0, firestore_1.getFirestore)();
    const doc_ref = await db.collection(exports.LOG_COLLECTIONS.DEBUG).add(Object.assign(Object.assign({}, entry), { timestamp: firestore_1.Timestamp.now() }));
    return doc_ref.id;
}
/**
 * Writes a trace summary.
 *
 * @param ctx - Trace context
 * @param trace_id - Trace ID (used as doc ID)
 * @param summary - Trace summary data
 */
async function write_trace_summary(ctx, trace_id, summary) {
    const db = (0, firestore_1.getFirestore)();
    await db.collection(exports.LOG_COLLECTIONS.TRACES).doc(trace_id).set(Object.assign(Object.assign({}, summary), { trace_id, timestamp: firestore_1.Timestamp.now() }));
}
//# sourceMappingURL=logs.repository.js.map