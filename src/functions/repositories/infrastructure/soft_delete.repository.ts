/**
 * Soft Delete Repository
 *
 * Repository layer for purging soft-deleted records across collections.
 * Handles permanent deletion of records marked as isDeleted=true.
 *
 * @module repository/infrastructure/soft_delete
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";

/**
 * Collections that support soft delete.
 */
export const SOFT_DELETE_COLLECTIONS = [
  "budgets",
  "budget_periods",
  "transactions",
  "plaidItems",
  "plaidAccounts",
  "recurringOutflows",
  "recurringInflows",
] as const;

export type SoftDeleteCollection = typeof SOFT_DELETE_COLLECTIONS[number];

/**
 * Purges soft-deleted records from a collection.
 *
 * @param ctx - Trace context
 * @param collection - Collection name
 * @param cutoff - Delete records soft-deleted before this timestamp
 * @param batch_size - Maximum records to delete per batch
 * @returns Count of purged records
 */
export async function purge_deleted_records(
  ctx: TraceContext,
  collection: string,
  cutoff: Timestamp,
  batch_size: number
): Promise<{ purged_count: number }> {
  const db = getFirestore();

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
export async function get_deleted_count(
  ctx: TraceContext,
  collection: string
): Promise<number> {
  const db = getFirestore();

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
export async function get_purgeable_count(
  ctx: TraceContext,
  collection: string,
  cutoff: Timestamp
): Promise<number> {
  const db = getFirestore();

  const result = await db
    .collection(collection)
    .where("isDeleted", "==", true)
    .where("deletedAt", "<", cutoff)
    .count()
    .get();

  return result.data().count;
}
