"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DERIVED_CACHE_TTL_MS = void 0;
exports.get_cached_result = get_cached_result;
exports.put_cached_result = put_cached_result;
const firestore_1 = require("firebase-admin/firestore");
/** Firestore hard limit is ~1 MiB/doc; stay well under to leave headroom for metadata. */
const MAX_CACHE_DOC_BYTES = 800000;
/** Cache-entry retention (Firestore TTL on `expire_at`). Correctness is via version-match,
 *  not freshness — 7 days is far beyond any active session. Enable a TTL policy on each
 *  cache collection's `expire_at` to auto-reap stale entries. */
const CACHE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** Serve a version-matched entry only within this TTL backstop (matches `derive_period`). */
exports.DERIVED_CACHE_TTL_MS = 10 * 60 * 1000;
/** Read a cached derived result from `collection/doc_id`, or null. 1 read. */
async function get_cached_result(collection, doc_id) {
    const snap = await (0, firestore_1.getFirestore)().collection(collection).doc(doc_id).get();
    if (!snap.exists)
        return null;
    return snap.data();
}
/**
 * Store a freshly-computed result stamped with the version it was computed at.
 * Fire-and-forget from the orchestrator (a failed cache write must never fail the derive).
 * Skips the write if the serialized result exceeds the size guard (e.g. a heavy budget's
 * unbounded transaction list) — that call just goes uncached.
 */
async function put_cached_result(collection, doc_id, data_version, result) {
    const approx_bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
    if (approx_bytes > MAX_CACHE_DOC_BYTES) {
        console.warn(`[derived_result_cache] Skipping cache for ${collection}/${doc_id}: ` +
            `result ~${approx_bytes}B exceeds ${MAX_CACHE_DOC_BYTES}B guard`);
        return;
    }
    const now_ms = firestore_1.Timestamp.now().toMillis();
    const doc = {
        data_version,
        computed_at_ms: now_ms,
        expire_at: firestore_1.Timestamp.fromMillis(now_ms + CACHE_RETENTION_MS),
        result,
    };
    await (0, firestore_1.getFirestore)().collection(collection).doc(doc_id).set(doc);
}
//# sourceMappingURL=derived_result_cache.repo.js.map