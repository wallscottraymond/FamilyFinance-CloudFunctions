"use strict";
/**
 * Idempotency Repository
 *
 * Repository layer for idempotency record operations.
 * Handles all Firestore access for the _idempotency collection.
 *
 * @module repository/infrastructure/idempotency
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STALE_IN_PROGRESS_MS = void 0;
exports.delete_expired_records = delete_expired_records;
exports.get_active_count = get_active_count;
exports.get_record = get_record;
exports.upsert_record = upsert_record;
exports.update_record = update_record;
exports.delete_record = delete_record;
exports.claim_key = claim_key;
const firestore_1 = require("firebase-admin/firestore");
/**
 * Collection name for idempotency records.
 */
const COLLECTION = "_idempotency";
/**
 * Deletes expired idempotency records in batches.
 *
 * @param ctx - Trace context
 * @param batch_size - Maximum records to delete per batch
 * @returns Count of deleted records
 */
async function delete_expired_records(ctx, batch_size) {
    const db = (0, firestore_1.getFirestore)();
    const now = firestore_1.Timestamp.now();
    const expired_docs = await db
        .collection(COLLECTION)
        .where("expires_at", "<", now)
        .limit(batch_size)
        .get();
    if (expired_docs.empty) {
        return { deleted_count: 0 };
    }
    const batch = db.batch();
    expired_docs.docs.forEach((doc) => {
        batch.delete(doc.ref);
    });
    await batch.commit();
    return { deleted_count: expired_docs.size };
}
/**
 * Gets count of active (non-expired) idempotency records.
 *
 * @param ctx - Trace context
 * @returns Count of active records
 */
async function get_active_count(_ctx) {
    const db = (0, firestore_1.getFirestore)();
    const now = firestore_1.Timestamp.now();
    const result = await db
        .collection(COLLECTION)
        .where("expires_at", ">=", now)
        .count()
        .get();
    return result.data().count;
}
/**
 * Checks if a key exists and is not expired.
 *
 * @param ctx - Trace context
 * @param key - Idempotency key
 * @returns The record if exists and not expired, null otherwise
 */
async function get_record(ctx, key) {
    const db = (0, firestore_1.getFirestore)();
    const doc = await db.collection(COLLECTION).doc(key).get();
    if (!doc.exists) {
        return null;
    }
    const record = doc.data();
    // Check if expired
    if (record.expires_at.toMillis() < Date.now()) {
        return null;
    }
    return record;
}
/**
 * Creates or updates an idempotency record.
 *
 * @param ctx - Trace context
 * @param key - Idempotency key
 * @param data - Record data
 */
async function upsert_record(ctx, key, data) {
    const db = (0, firestore_1.getFirestore)();
    const record = Object.assign({ key }, data);
    await db.collection(COLLECTION).doc(key).set(record);
}
/**
 * Updates an existing idempotency record.
 *
 * @param ctx - Trace context
 * @param key - Idempotency key
 * @param data - Partial record data to update
 */
async function update_record(ctx, key, data) {
    const db = (0, firestore_1.getFirestore)();
    await db.collection(COLLECTION).doc(key).update(data);
}
/**
 * Deletes an idempotency record.
 *
 * @param ctx - Trace context
 * @param key - Idempotency key
 */
async function delete_record(ctx, key) {
    const db = (0, firestore_1.getFirestore)();
    await db.collection(COLLECTION).doc(key).delete();
}
/**
 * Claims an idempotency key using a transaction.
 *
 * @param ctx - Trace context
 * @param key - Idempotency key
 * @param ttl_ms - TTL in milliseconds
 * @returns true if claimed, false if already claimed
 */
/** Longer than any function's timeout (540 s): an older "in_progress" claim was killed. */
exports.STALE_IN_PROGRESS_MS = 10 * 60 * 1000;
async function claim_key(ctx, key, ttl_ms) {
    const db = (0, firestore_1.getFirestore)();
    const doc_ref = db.collection(COLLECTION).doc(key);
    try {
        await db.runTransaction(async (transaction) => {
            var _a, _b, _c;
            const doc = await transaction.get(doc_ref);
            if (doc.exists) {
                const record = doc.data();
                const live = record.expires_at.toMillis() >= Date.now();
                // A retry may take over a key whose attempt FAILED, or one stuck "in_progress" longer than
                // any function can run (killed mid-call) — otherwise the client's retry under the same key
                // is refused as "in progress" until the TTL ends (Code-Health-Review batch 9 verify M2).
                // A COMPLETED key is never re-run (callers return its cached result before claiming).
                const stale_in_progress = record.status === "in_progress" &&
                    Date.now() - ((_c = (_b = (_a = record.created_at) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : 0) > exports.STALE_IN_PROGRESS_MS;
                if (live && !(record.status === "failed" || stale_in_progress)) {
                    throw new Error("Key already claimed");
                }
            }
            const now = firestore_1.Timestamp.now();
            const record = {
                key,
                status: "in_progress",
                created_at: now,
                expires_at: firestore_1.Timestamp.fromMillis(now.toMillis() + ttl_ms),
                trace_id: ctx.trace_id,
            };
            transaction.set(doc_ref, record);
        });
        return true;
    }
    catch (_a) {
        return false;
    }
}
//# sourceMappingURL=idempotency.repository.js.map