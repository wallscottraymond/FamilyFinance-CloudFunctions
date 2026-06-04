"use strict";
/**
 * Soft Delete Repository
 *
 * Repository layer for purging soft-deleted records across collections.
 * Handles permanent deletion of records marked as isDeleted=true.
 *
 * @module repository/infrastructure/soft_delete
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SOFT_DELETE_COLLECTIONS = void 0;
exports.purge_deleted_records = purge_deleted_records;
exports.get_deleted_count = get_deleted_count;
exports.get_purgeable_count = get_purgeable_count;
const firestore_1 = require("firebase-admin/firestore");
/**
 * Collections that support soft delete.
 */
exports.SOFT_DELETE_COLLECTIONS = [
    "budgets",
    "budget_periods",
    "transactions",
    "plaidItems",
    "plaidAccounts",
    "recurringOutflows",
    "recurringInflows",
];
/**
 * Purges soft-deleted records from a collection.
 *
 * @param ctx - Trace context
 * @param collection - Collection name
 * @param cutoff - Delete records soft-deleted before this timestamp
 * @param batch_size - Maximum records to delete per batch
 * @returns Count of purged records
 */
async function purge_deleted_records(ctx, collection, cutoff, batch_size) {
    const db = (0, firestore_1.getFirestore)();
    const old_docs = await db
        .collection(collection)
        .where("isDeleted", "==", true)
        .where("deletedAt", "<", cutoff)
        .limit(batch_size)
        .get();
    if (old_docs.empty) {
        return { purged_count: 0 };
    }
    const batch = db.batch();
    old_docs.docs.forEach((doc) => {
        batch.delete(doc.ref);
    });
    await batch.commit();
    return { purged_count: old_docs.size };
}
/**
 * Gets count of soft-deleted records in a collection.
 *
 * @param ctx - Trace context
 * @param collection - Collection name
 * @returns Count of soft-deleted records
 */
async function get_deleted_count(ctx, collection) {
    const db = (0, firestore_1.getFirestore)();
    const result = await db
        .collection(collection)
        .where("isDeleted", "==", true)
        .count()
        .get();
    return result.data().count;
}
/**
 * Gets count of soft-deleted records older than cutoff.
 *
 * @param ctx - Trace context
 * @param collection - Collection name
 * @param cutoff - Count records soft-deleted before this timestamp
 * @returns Count of purgeable records
 */
async function get_purgeable_count(ctx, collection, cutoff) {
    const db = (0, firestore_1.getFirestore)();
    const result = await db
        .collection(collection)
        .where("isDeleted", "==", true)
        .where("deletedAt", "<", cutoff)
        .count()
        .get();
    return result.data().count;
}
//# sourceMappingURL=soft_delete.repository.js.map