/**
 * Purge Repository
 *
 * Persistence primitives for the full-erase purge: batched HARD deletes by
 * field or by parent-id, id collection, pending-job cancellation, and the
 * defensive group ownership checks. Purge intentionally hard-deletes (not the
 * per-entity soft-delete repos) — it must leave nothing behind.
 *
 * All deletes are batched at the Firestore 500-doc limit and loop until the
 * query is dry, so an arbitrarily large user (1000s of txns) purges without a
 * single oversized batch. Every method is idempotent — a re-run simply finds
 * fewer (or zero) matching docs.
 *
 * @module repositories/purge
 */

import { getFirestore, Timestamp, FieldPath } from "firebase-admin/firestore";
import type { BulkWriter } from "firebase-admin/firestore";

const BATCH_LIMIT = 500;
/** How many doc ids to read per page (keys-only). */
const READ_PAGE = 1000;

/**
 * A BulkWriter parallelizes deletes (auto-batches, ramps throughput, retries)
 * — far faster than sequential 500-doc `batch.commit()`s for a big purge. One
 * writer is shared across all of a run's sweeps; `flush()`/`close()` awaits them.
 */
export function make_bulk_writer(): BulkWriter {
  return getFirestore().bulkWriter();
}

/** Collect the doc ids in `collection` where `field == value`. */
export async function collect_ids(
  collection: string,
  field: string,
  value: string
): Promise<string[]> {
  const snap = await getFirestore()
    .collection(collection)
    .where(field, "==", value)
    .select()
    .get();
  return snap.docs.map((d) => d.id);
}

/** Called after each read page with the number enqueued for delete — lets the
 *  caller stream live progress during a large sweep. */
export type OnBatch = (enqueued_in_page: number) => Promise<void> | void;

/**
 * Hard-delete every doc in `collection` where `field == value`, enqueuing the
 * deletes onto the shared BulkWriter (which commits them in parallel). Reads the
 * ids keys-only, paginated by document id (stable — deletes are async so we
 * can't re-query the same predicate). Returns the count enqueued. `on_batch`
 * fires per read page for live progress.
 *
 * NOTE: an equality filter + `orderBy(documentId())` is served by the automatic
 * single-field index — no composite index required.
 */
export async function hard_delete_by_field(
  collection: string,
  field: string,
  value: string,
  writer: BulkWriter,
  on_batch?: OnBatch
): Promise<number> {
  const db = getFirestore();
  let total = 0;
  let last: string | undefined;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = db
      .collection(collection)
      .where(field, "==", value)
      .orderBy(FieldPath.documentId())
      .limit(READ_PAGE)
      .select();
    if (last !== undefined) {
      q = q.startAfter(last);
    }
    const snap = await q.get();
    if (snap.empty) {
      break;
    }
    for (const doc of snap.docs) {
      // BulkWriter.delete returns a promise we intentionally don't await here —
      // the writer commits in parallel; `flush()`/`close()` awaits them later.
      void writer.delete(doc.ref);
    }
    total += snap.size;
    last = snap.docs[snap.docs.length - 1].id;
    if (on_batch) {
      await on_batch(snap.size);
    }
    if (snap.size < READ_PAGE) {
      break;
    }
  }
  return total;
}

/**
 * Hard-delete every doc in `collection` whose `parent_field` is one of
 * `parent_ids` (the "subcollection" pattern — these are top-level collections
 * keyed by a parent id). Iterates parent ids; each is its own batched sweep.
 */
export async function hard_delete_by_parent_ids(
  collection: string,
  parent_field: string,
  parent_ids: string[],
  writer: BulkWriter,
  on_batch?: OnBatch
): Promise<number> {
  let total = 0;
  for (const parent_id of parent_ids) {
    total += await hard_delete_by_field(collection, parent_field, parent_id, writer, on_batch);
  }
  return total;
}

/**
 * Cancel the user's PENDING/PROCESSING jobs so nothing runs mid/post-purge.
 * Marks them `cancelled` (terminal) rather than deleting, preserving the audit
 * trail. Matches on `payload.user_id` (the convention across job payloads).
 *
 * TARGETED by default: queries only THIS user's pending/processing jobs via the
 * `_jobs (payload.user_id, status)` composite index — so it scales when many
 * users purge concurrently (no scan of the global queue). Falls back to a full
 * scan only if that query fails (e.g. the index is still building after deploy).
 */
export async function cancel_pending_jobs(
  user_id: string,
  exclude_job_id?: string
): Promise<number> {
  try {
    return await cancel_pending_jobs_targeted(user_id, exclude_job_id);
  } catch (err) {
    // Most likely FAILED_PRECONDITION (composite index not built yet). The scan
    // is the correct (slower) superset behavior — use it so a purge never breaks.
    console.warn(
      `[purge] targeted job-cancel failed (${(err as Error).message}); ` +
        `falling back to full scan`
    );
    return await cancel_pending_jobs_scan(user_id, exclude_job_id);
  }
}

/** Skip predicate shared by both strategies. */
function should_skip_job(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  exclude_job_id?: string
): boolean {
  if (doc.id === exclude_job_id) {
    return true;
  }
  // Never cancel a purge job (incl. this one) — that would abort the erase.
  return doc.data().job_type === "purge_user_data";
}

/** Mark a page of jobs `cancelled` in ≤500 batches. Returns the count. */
async function cancel_docs(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  exclude_job_id: string | undefined,
  now: Timestamp
): Promise<number> {
  const db = getFirestore();
  const to_cancel = docs.filter((d) => !should_skip_job(d, exclude_job_id));
  let cancelled = 0;
  for (let i = 0; i < to_cancel.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const doc of to_cancel.slice(i, i + BATCH_LIMIT)) {
      batch.update(doc.ref, {
        status: "cancelled",
        updated_at: now,
        error_message: "user_purge",
      });
      cancelled++;
    }
    await batch.commit();
  }
  return cancelled;
}

/** Targeted: only this user's pending/processing jobs (composite index). */
async function cancel_pending_jobs_targeted(
  user_id: string,
  exclude_job_id?: string
): Promise<number> {
  const db = getFirestore();
  const now = Timestamp.now();
  let cancelled = 0;
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  // Cursor pagination (by document id): skipped docs — the purge job itself —
  // stay pending, so a re-query of the same predicate would loop forever; the
  // cursor advances past them instead.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = db
      .collection("_jobs")
      .where("payload.user_id", "==", user_id)
      .where("status", "in", ["pending", "processing"])
      .orderBy(FieldPath.documentId())
      .limit(READ_PAGE);
    if (last) {
      q = q.startAfter(last.id);
    }
    const snap = await q.get();
    if (snap.empty) {
      break;
    }
    cancelled += await cancel_docs(snap.docs, exclude_job_id, now);
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < READ_PAGE) {
      break;
    }
  }
  return cancelled;
}

/** Fallback: scan all pending/processing jobs, filter by user in memory. */
async function cancel_pending_jobs_scan(
  user_id: string,
  exclude_job_id?: string
): Promise<number> {
  const db = getFirestore();
  const now = Timestamp.now();
  const snap = await db
    .collection("_jobs")
    .where("status", "in", ["pending", "processing"])
    .get();
  const matching = snap.docs.filter((d) => {
    const payload = (d.data().payload ?? {}) as { user_id?: string };
    return payload.user_id === user_id;
  });
  return cancel_docs(matching, exclude_job_id, now);
}

/**
 * Groups the user OWNS that still have other members — a purge must not orphan
 * these; the caller blocks until ownership is transferred. Defensive against
 * the in-flight sharing schema (`groups` uses `ownerId`+`members[]`; the legacy
 * `families` uses `adminUserId`+`memberIds[]`) — checks both, never throws.
 */
export async function find_owned_shared_groups(
  user_id: string
): Promise<Array<{ id: string; name: string }>> {
  const db = getFirestore();
  const out: Array<{ id: string; name: string }> = [];

  try {
    const groups = await db
      .collection("groups")
      .where("ownerId", "==", user_id)
      .get();
    for (const d of groups.docs) {
      const data = d.data() as { name?: string; members?: unknown[]; isActive?: boolean };
      if (data.isActive !== false && (data.members?.length ?? 0) > 1) {
        out.push({ id: d.id, name: data.name ?? "Untitled group" });
      }
    }
  } catch {
    // groups collection absent / schema drift — ignore (nothing to block on).
  }

  try {
    const families = await db
      .collection("families")
      .where("adminUserId", "==", user_id)
      .get();
    for (const d of families.docs) {
      const data = d.data() as { name?: string; memberIds?: unknown[] };
      if ((data.memberIds?.length ?? 0) > 1) {
        out.push({ id: d.id, name: data.name ?? "Untitled family" });
      }
    }
  } catch {
    // families collection absent — ignore.
  }

  return out;
}

/**
 * Hard-delete the SOLE-member groups/families the user owns (nothing to
 * transfer). Owned groups with other members are handled by the pre-check
 * block, so by purge time only solo groups remain. Best-effort / never throws.
 *
 * NOTE: cleanup of the user's membership in groups OWNED BY OTHERS is deferred
 * — it depends on the in-flight embedded-membership model (see project doc).
 */
export async function delete_owned_solo_groups(user_id: string): Promise<number> {
  const db = getFirestore();
  let deleted = 0;

  for (const [collection, ownerField, membersField] of [
    ["groups", "ownerId", "members"],
    ["families", "adminUserId", "memberIds"],
  ] as const) {
    try {
      const snap = await db
        .collection(collection)
        .where(ownerField, "==", user_id)
        .get();
      const batch = db.batch();
      let n = 0;
      for (const d of snap.docs) {
        const members = (d.data()[membersField] as unknown[] | undefined) ?? [];
        if (members.length <= 1) {
          batch.delete(d.ref);
          n++;
        }
      }
      if (n > 0) {
        await batch.commit();
        deleted += n;
      }
    } catch {
      // collection absent / schema drift — ignore.
    }
  }
  return deleted;
}

/** Hard-delete a single doc by id (used for `users/{uid}`). Idempotent. */
export async function hard_delete_doc(
  collection: string,
  doc_id: string
): Promise<void> {
  await getFirestore().collection(collection).doc(doc_id).delete();
}
