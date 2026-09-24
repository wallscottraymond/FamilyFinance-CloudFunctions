/**
 * Derived-Result Cache Repository (generic)
 *
 * The generic version of `derive_period_cache` for the SIBLING derive-on-read callables
 * ([[Firestore-Read-Cost-Reduction]] B′): `derive_budget_transactions` and
 * `derive_recurring_view`. Each stores one doc per (user, ...call params) holding the
 * fully-computed result + the per-user `data_version` it was computed at + `computed_at_ms`.
 *
 * A caller reads this + the user's current `data_version` (2 reads). If the doc's version
 * matches AND it's within the TTL backstop, it returns the cached result — skipping the
 * window transaction read (~348 docs) + in-memory derivation. Correctness comes from the
 * version match (bumped by every derive-input write); the TTL only bounds staleness if some
 * write path forgot to bump. Each callable uses its OWN collection + doc-id builder so key
 * shapes never collide.
 *
 * @module repositories/derived_result_cache
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";

/** Firestore hard limit is ~1 MiB/doc; stay well under to leave headroom for metadata. */
const MAX_CACHE_DOC_BYTES = 800_000;

/** Cache-entry retention (Firestore TTL on `expire_at`). Correctness is via version-match,
 *  not freshness — 7 days is far beyond any active session. Enable a TTL policy on each
 *  cache collection's `expire_at` to auto-reap stale entries. */
const CACHE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Serve a version-matched entry only within this TTL backstop (matches `derive_period`). */
export const DERIVED_CACHE_TTL_MS = 10 * 60 * 1000;

export interface CachedDerivedResult<TResult> {
  data_version: number;
  computed_at_ms: number;
  /** TTL field: Firestore auto-deletes the entry once past (= computed_at + retention). */
  expire_at: Timestamp;
  result: TResult;
}

/** Read a cached derived result from `collection/doc_id`, or null. 1 read. */
export async function get_cached_result<TResult>(
  collection: string,
  doc_id: string
): Promise<CachedDerivedResult<TResult> | null> {
  const snap = await getFirestore().collection(collection).doc(doc_id).get();
  if (!snap.exists) return null;
  return snap.data() as CachedDerivedResult<TResult>;
}

/**
 * Store a freshly-computed result stamped with the version it was computed at.
 * Fire-and-forget from the orchestrator (a failed cache write must never fail the derive).
 * Skips the write if the serialized result exceeds the size guard (e.g. a heavy budget's
 * unbounded transaction list) — that call just goes uncached.
 */
export async function put_cached_result<TResult>(
  collection: string,
  doc_id: string,
  data_version: number,
  result: TResult
): Promise<void> {
  const approx_bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  if (approx_bytes > MAX_CACHE_DOC_BYTES) {
    console.warn(
      `[derived_result_cache] Skipping cache for ${collection}/${doc_id}: ` +
        `result ~${approx_bytes}B exceeds ${MAX_CACHE_DOC_BYTES}B guard`
    );
    return;
  }
  const now_ms = Timestamp.now().toMillis();
  const doc: CachedDerivedResult<TResult> = {
    data_version,
    computed_at_ms: now_ms,
    expire_at: Timestamp.fromMillis(now_ms + CACHE_RETENTION_MS),
    result,
  };
  await getFirestore().collection(collection).doc(doc_id).set(doc);
}
