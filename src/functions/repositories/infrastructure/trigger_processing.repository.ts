/**
 * Trigger Processing Repository
 *
 * Repository layer for trigger processing record operations.
 * Handles all Firestore access for the _trigger_processing collection.
 *
 * @module repository/infrastructure/trigger_processing
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";

/**
 * Collection name for trigger processing records.
 */
const COLLECTION = "_trigger_processing";

/**
 * Trigger processing record.
 */
export interface TriggerProcessingRecord {
  /** Unique key for the trigger event */
  key: string;

  /** Document ID that triggered the event */
  document_id: string;

  /** Firebase event ID */
  event_id: string;

  /** When the trigger was processed */
  processed_at: Timestamp;

  /** Trace ID for correlation */
  trace_id?: string;
}

/**
 * Deletes old trigger processing records.
 *
 * @param ctx - Trace context
 * @param cutoff - Delete records older than this timestamp
 * @param batch_size - Maximum records to delete per batch
 * @returns Count of deleted records
 */
export async function delete_old_records(
  ctx: TraceContext,
  cutoff: Timestamp,
  batch_size: number
): Promise<{ deleted_count: number }> {
  const db = getFirestore();

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
export async function is_processed(
  ctx: TraceContext,
  key: string
): Promise<boolean> {
  const db = getFirestore();
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
export async function mark_processed(
  ctx: TraceContext,
  key: string,
  document_id: string,
  event_id: string
): Promise<void> {
  const db = getFirestore();

  const record: TriggerProcessingRecord = {
    key,
    document_id,
    event_id,
    processed_at: Timestamp.now(),
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
export async function get_record_count(_ctx: TraceContext): Promise<number> {
  const db = getFirestore();

  const result = await db.collection(COLLECTION).count().get();

  return result.data().count;
}
