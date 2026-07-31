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
import type { BulkWriter } from "firebase-admin/firestore";
/**
 * A BulkWriter parallelizes deletes (auto-batches, ramps throughput, retries)
 * — far faster than sequential 500-doc `batch.commit()`s for a big purge. One
 * writer is shared across all of a run's sweeps; `flush()`/`close()` awaits them.
 */
export declare function make_bulk_writer(): BulkWriter;
/** Collect the doc ids in `collection` where `field == value`. */
export declare function collect_ids(collection: string, field: string, value: string): Promise<string[]>;
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
export declare function hard_delete_by_field(collection: string, field: string, value: string, writer: BulkWriter, on_batch?: OnBatch): Promise<number>;
/**
 * Hard-delete every doc in `collection` whose `parent_field` is one of
 * `parent_ids` (the "subcollection" pattern — these are top-level collections
 * keyed by a parent id). Iterates parent ids; each is its own batched sweep.
 */
export declare function hard_delete_by_parent_ids(collection: string, parent_field: string, parent_ids: string[], writer: BulkWriter, on_batch?: OnBatch): Promise<number>;
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
export declare function cancel_pending_jobs(user_id: string, exclude_job_id?: string): Promise<number>;
/**
 * Groups the user OWNS that still have other members — a purge must not orphan
 * these; the caller blocks until ownership is transferred. Defensive against
 * the in-flight sharing schema (`groups` uses `ownerId`+`members[]`; the legacy
 * `families` uses `adminUserId`+`memberIds[]`) — checks both, never throws.
 */
export declare function find_owned_shared_groups(user_id: string): Promise<Array<{
    id: string;
    name: string;
}>>;
/**
 * Hard-delete the SOLE-member groups/families the user owns (nothing to
 * transfer). Owned groups with other members are handled by the pre-check
 * block, so by purge time only solo groups remain. Best-effort / never throws.
 *
 * NOTE: cleanup of the user's membership in groups OWNED BY OTHERS is deferred
 * — it depends on the in-flight embedded-membership model (see project doc).
 */
export declare function delete_owned_solo_groups(user_id: string): Promise<number>;
/** Hard-delete a single doc by id (used for `users/{uid}`). Idempotent. */
export declare function hard_delete_doc(collection: string, doc_id: string): Promise<void>;
//# sourceMappingURL=purge.repo.d.ts.map