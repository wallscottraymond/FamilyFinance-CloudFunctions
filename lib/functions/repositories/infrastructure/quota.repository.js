"use strict";
/**
 * Quota Repository
 *
 * Repository layer for quota tracking operations.
 * Handles all Firestore access for _quota_tracking and _quota_snapshots.
 *
 * @module repository/infrastructure/quota
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.get_today_usage = get_today_usage;
exports.increment_reads = increment_reads;
exports.increment_writes = increment_writes;
exports.save_snapshot = save_snapshot;
exports.get_latest_snapshot = get_latest_snapshot;
exports.delete_old_tracking = delete_old_tracking;
exports.delete_old_snapshots = delete_old_snapshots;
const firestore_1 = require("firebase-admin/firestore");
/**
 * Collection names.
 */
const COLLECTIONS = {
    TRACKING: "_quota_tracking",
    SNAPSHOTS: "_quota_snapshots",
};
/**
 * Gets today's date string in YYYY-MM-DD format (UTC).
 */
function get_today_string() {
    return new Date().toISOString().split("T")[0];
}
/**
 * Gets current quota usage for today.
 *
 * @param ctx - Trace context
 * @returns Current reads and writes count
 */
async function get_today_usage(_ctx) {
    var _a, _b;
    const db = (0, firestore_1.getFirestore)();
    const today = get_today_string();
    const doc = await db.collection(COLLECTIONS.TRACKING).doc(today).get();
    if (!doc.exists) {
        return { reads: 0, writes: 0 };
    }
    const data = doc.data();
    return {
        reads: (_a = data.reads) !== null && _a !== void 0 ? _a : 0,
        writes: (_b = data.writes) !== null && _b !== void 0 ? _b : 0,
    };
}
/**
 * Increments read counter for today.
 *
 * @param ctx - Trace context
 * @param count - Number of reads to add
 */
async function increment_reads(ctx, count) {
    const db = (0, firestore_1.getFirestore)();
    const today = get_today_string();
    const doc_ref = db.collection(COLLECTIONS.TRACKING).doc(today);
    await doc_ref.set({
        date: today,
        reads: firestore_1.FieldValue.increment(count),
        updated_at: firestore_1.Timestamp.now(),
    }, { merge: true });
}
/**
 * Increments write counter for today.
 *
 * @param ctx - Trace context
 * @param count - Number of writes to add
 */
async function increment_writes(ctx, count) {
    const db = (0, firestore_1.getFirestore)();
    const today = get_today_string();
    const doc_ref = db.collection(COLLECTIONS.TRACKING).doc(today);
    await doc_ref.set({
        date: today,
        writes: firestore_1.FieldValue.increment(count),
        updated_at: firestore_1.Timestamp.now(),
    }, { merge: true });
}
/**
 * Saves a quota snapshot.
 *
 * @param ctx - Trace context
 * @param snapshot - Snapshot data
 */
async function save_snapshot(ctx, snapshot) {
    const db = (0, firestore_1.getFirestore)();
    const data = Object.assign(Object.assign({}, snapshot), { timestamp: firestore_1.Timestamp.now() });
    // Save as "latest" for health checks
    await db.collection(COLLECTIONS.SNAPSHOTS).doc("latest").set(data);
    // Also save historical snapshot
    await db.collection(COLLECTIONS.SNAPSHOTS).add(data);
}
/**
 * Gets the latest quota snapshot.
 *
 * @param ctx - Trace context
 * @returns Latest snapshot or null
 */
async function get_latest_snapshot(_ctx) {
    const db = (0, firestore_1.getFirestore)();
    const doc = await db.collection(COLLECTIONS.SNAPSHOTS).doc("latest").get();
    if (!doc.exists) {
        return null;
    }
    return doc.data();
}
/**
 * Deletes old quota tracking records.
 *
 * @param ctx - Trace context
 * @param cutoff_date - Delete records before this date (YYYY-MM-DD)
 * @param batch_size - Maximum records to delete per batch
 * @returns Count of deleted records
 */
async function delete_old_tracking(ctx, cutoff_date, batch_size) {
    const db = (0, firestore_1.getFirestore)();
    const old_docs = await db
        .collection(COLLECTIONS.TRACKING)
        .where("date", "<", cutoff_date)
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
 * Deletes old quota snapshots.
 *
 * @param ctx - Trace context
 * @param cutoff - Delete snapshots older than this timestamp
 * @param batch_size - Maximum records to delete per batch
 * @returns Count of deleted records
 */
async function delete_old_snapshots(ctx, cutoff, batch_size) {
    const db = (0, firestore_1.getFirestore)();
    const old_docs = await db
        .collection(COLLECTIONS.SNAPSHOTS)
        .where("timestamp", "<", cutoff)
        .limit(batch_size)
        .get();
    // Filter out "latest" doc
    const to_delete = old_docs.docs.filter((doc) => doc.id !== "latest");
    if (to_delete.length === 0) {
        return { deleted_count: 0 };
    }
    const batch = db.batch();
    to_delete.forEach((doc) => {
        batch.delete(doc.ref);
    });
    await batch.commit();
    return { deleted_count: to_delete.length };
}
//# sourceMappingURL=quota.repository.js.map