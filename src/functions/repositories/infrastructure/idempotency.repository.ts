/**
 * Idempotency Repository
 *
 * Repository layer for idempotency record operations.
 * Handles all Firestore access for the _idempotency collection.
 *
 * @module repository/infrastructure/idempotency
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";

/**
 * Collection name for idempotency records.
 */
const COLLECTION = "_idempotency";

/**
 * Stored idempotency record.
 */
export interface IdempotencyRecord {
  key: string;
  status: "in_progress" | "completed" | "failed";
  result?: unknown;
  error_message?: string;
  created_at: Timestamp;
  expires_at: Timestamp;
  trace_id?: string;
}

/**
 * Deletes expired idempotency records in batches.
 *
 * @param ctx - Trace context
 * @param batch_size - Maximum records to delete per batch
 * @returns Count of deleted records
 */
export async function delete_expired_records(
  ctx: TraceContext,
  batch_size: number
): Promise<{ deleted_count: number }> {
  const db = getFirestore();
  const now = Timestamp.now();

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
export async function get_active_count(_ctx: TraceContext): Promise<number> {
  const db = getFirestore();
  const now = Timestamp.now();

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
export async function get_record(
  ctx: TraceContext,
  key: string
): Promise<IdempotencyRecord | null> {
  const db = getFirestore();
  const doc = await db.collection(COLLECTION).doc(key).get();

  if (!doc.exists) {
    return null;
  }

  const record = doc.data() as IdempotencyRecord;

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
export async function upsert_record(
  ctx: TraceContext,
  key: string,
  data: Omit<IdempotencyRecord, "key">
): Promise<void> {
  const db = getFirestore();
  const record: IdempotencyRecord = { key, ...data };

  await db.collection(COLLECTION).doc(key).set(record);
}

/**
 * Updates an existing idempotency record.
 *
 * @param ctx - Trace context
 * @param key - Idempotency key
 * @param data - Partial record data to update
 */
export async function update_record(
  ctx: TraceContext,
  key: string,
  data: Partial<IdempotencyRecord>
): Promise<void> {
  const db = getFirestore();

  await db.collection(COLLECTION).doc(key).update(data);
}

/**
 * Deletes an idempotency record.
 *
 * @param ctx - Trace context
 * @param key - Idempotency key
 */
export async function delete_record(
  ctx: TraceContext,
  key: string
): Promise<void> {
  const db = getFirestore();

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
export async function claim_key(
  ctx: TraceContext,
  key: string,
  ttl_ms: number
): Promise<boolean> {
  const db = getFirestore();
  const doc_ref = db.collection(COLLECTION).doc(key);

  try {
    await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(doc_ref);

      if (doc.exists) {
        const record = doc.data() as IdempotencyRecord;
        if (record.expires_at.toMillis() >= Date.now()) {
          throw new Error("Key already claimed");
        }
      }

      const now = Timestamp.now();
      const record: IdempotencyRecord = {
        key,
        status: "in_progress",
        created_at: now,
        expires_at: Timestamp.fromMillis(now.toMillis() + ttl_ms),
        trace_id: ctx.trace_id,
      };

      transaction.set(doc_ref, record);
    });

    return true;
  } catch {
    return false;
  }
}
