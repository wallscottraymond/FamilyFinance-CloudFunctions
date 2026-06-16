/**
 * Quota Repository
 *
 * Repository layer for quota tracking operations.
 * Handles all Firestore access for _quota_tracking and _quota_snapshots.
 *
 * @module repository/infrastructure/quota
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";

/**
 * Collection names.
 */
const COLLECTIONS = {
  TRACKING: "_quota_tracking",
  SNAPSHOTS: "_quota_snapshots",
} as const;

/**
 * Quota tracking document.
 */
export interface QuotaTrackingDoc {
  date: string;
  reads: number;
  writes: number;
  updated_at: Timestamp;
}

/**
 * Quota snapshot document.
 */
export interface QuotaSnapshotDoc {
  reads_percent: number;
  writes_percent: number;
  reads_count: number;
  writes_count: number;
  limits: {
    daily_reads: number;
    daily_writes: number;
  };
  timestamp: Timestamp;
}

/**
 * Gets today's date string in YYYY-MM-DD format (UTC).
 */
function get_today_string(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Gets current quota usage for today.
 *
 * @param ctx - Trace context
 * @returns Current reads and writes count
 */
export async function get_today_usage(
  _ctx: TraceContext
): Promise<{ reads: number; writes: number }> {
  const db = getFirestore();
  const today = get_today_string();
  const doc = await db.collection(COLLECTIONS.TRACKING).doc(today).get();

  if (!doc.exists) {
    return { reads: 0, writes: 0 };
  }

  const data = doc.data() as QuotaTrackingDoc;
  return {
    reads: data.reads ?? 0,
    writes: data.writes ?? 0,
  };
}

/**
 * Increments read counter for today.
 *
 * @param ctx - Trace context
 * @param count - Number of reads to add
 */
export async function increment_reads(
  ctx: TraceContext,
  count: number
): Promise<void> {
  const db = getFirestore();
  const today = get_today_string();
  const doc_ref = db.collection(COLLECTIONS.TRACKING).doc(today);

  // Read-modify-REPLACE (no blind FieldValue.increment) — atomic via transaction.
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(doc_ref);
    const current = (snap.data()?.reads as number | undefined) ?? 0;
    tx.set(
      doc_ref,
      { date: today, reads: current + count, updated_at: Timestamp.now() },
      { merge: true }
    );
  });
}

/**
 * Increments write counter for today.
 *
 * @param ctx - Trace context
 * @param count - Number of writes to add
 */
export async function increment_writes(
  ctx: TraceContext,
  count: number
): Promise<void> {
  const db = getFirestore();
  const today = get_today_string();
  const doc_ref = db.collection(COLLECTIONS.TRACKING).doc(today);

  // Read-modify-REPLACE (no blind FieldValue.increment) — atomic via transaction.
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(doc_ref);
    const current = (snap.data()?.writes as number | undefined) ?? 0;
    tx.set(
      doc_ref,
      { date: today, writes: current + count, updated_at: Timestamp.now() },
      { merge: true }
    );
  });
}

/**
 * Saves a quota snapshot.
 *
 * @param ctx - Trace context
 * @param snapshot - Snapshot data
 */
export async function save_snapshot(
  ctx: TraceContext,
  snapshot: Omit<QuotaSnapshotDoc, "timestamp">
): Promise<void> {
  const db = getFirestore();
  const data: QuotaSnapshotDoc = {
    ...snapshot,
    timestamp: Timestamp.now(),
  };

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
export async function get_latest_snapshot(
  _ctx: TraceContext
): Promise<QuotaSnapshotDoc | null> {
  const db = getFirestore();
  const doc = await db.collection(COLLECTIONS.SNAPSHOTS).doc("latest").get();

  if (!doc.exists) {
    return null;
  }

  return doc.data() as QuotaSnapshotDoc;
}

/**
 * Deletes old quota tracking records.
 *
 * @param ctx - Trace context
 * @param cutoff_date - Delete records before this date (YYYY-MM-DD)
 * @param batch_size - Maximum records to delete per batch
 * @returns Count of deleted records
 */
export async function delete_old_tracking(
  ctx: TraceContext,
  cutoff_date: string,
  batch_size: number
): Promise<{ deleted_count: number }> {
  const db = getFirestore();

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
export async function delete_old_snapshots(
  ctx: TraceContext,
  cutoff: Timestamp,
  batch_size: number
): Promise<{ deleted_count: number }> {
  const db = getFirestore();

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
