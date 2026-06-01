/**
 * Logs Repository
 *
 * Repository layer for log record operations.
 * Handles all Firestore access for _logs_minimal, _logs_debug, and _traces.
 *
 * @module repository/infrastructure/logs
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";

/**
 * Collection names for logs.
 */
export const LOG_COLLECTIONS = {
  MINIMAL: "_logs_minimal",
  DEBUG: "_logs_debug",
  TRACES: "_traces",
} as const;

/**
 * Deletes old log records from a collection.
 *
 * @param ctx - Trace context
 * @param collection - Collection name
 * @param cutoff - Delete records older than this timestamp
 * @param batch_size - Maximum records to delete per batch
 * @returns Count of deleted records
 */
export async function delete_old_records(
  ctx: TraceContext,
  collection: string,
  cutoff: Timestamp,
  batch_size: number
): Promise<{ deleted_count: number }> {
  const db = getFirestore();

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
export async function get_record_count(
  ctx: TraceContext,
  collection: string
): Promise<number> {
  const db = getFirestore();

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
export async function write_minimal_log(
  ctx: TraceContext,
  entry: Record<string, unknown>
): Promise<string> {
  const db = getFirestore();

  const doc_ref = await db.collection(LOG_COLLECTIONS.MINIMAL).add({
    ...entry,
    timestamp: Timestamp.now(),
  });

  return doc_ref.id;
}

/**
 * Writes a debug log entry.
 *
 * @param ctx - Trace context
 * @param entry - Log entry data
 * @returns The created document ID
 */
export async function write_debug_log(
  ctx: TraceContext,
  entry: Record<string, unknown>
): Promise<string> {
  const db = getFirestore();

  const doc_ref = await db.collection(LOG_COLLECTIONS.DEBUG).add({
    ...entry,
    timestamp: Timestamp.now(),
  });

  return doc_ref.id;
}

/**
 * Writes a trace summary.
 *
 * @param ctx - Trace context
 * @param trace_id - Trace ID (used as doc ID)
 * @param summary - Trace summary data
 */
export async function write_trace_summary(
  ctx: TraceContext,
  trace_id: string,
  summary: Record<string, unknown>
): Promise<void> {
  const db = getFirestore();

  await db.collection(LOG_COLLECTIONS.TRACES).doc(trace_id).set({
    ...summary,
    trace_id,
    timestamp: Timestamp.now(),
  });
}
