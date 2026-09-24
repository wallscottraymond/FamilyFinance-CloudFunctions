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
import { Timestamp } from "firebase-admin/firestore";
/** Serve a version-matched entry only within this TTL backstop (matches `derive_period`). */
export declare const DERIVED_CACHE_TTL_MS: number;
export interface CachedDerivedResult<TResult> {
    data_version: number;
    computed_at_ms: number;
    /** TTL field: Firestore auto-deletes the entry once past (= computed_at + retention). */
    expire_at: Timestamp;
    result: TResult;
}
/** Read a cached derived result from `collection/doc_id`, or null. 1 read. */
export declare function get_cached_result<TResult>(collection: string, doc_id: string): Promise<CachedDerivedResult<TResult> | null>;
/**
 * Store a freshly-computed result stamped with the version it was computed at.
 * Fire-and-forget from the orchestrator (a failed cache write must never fail the derive).
 * Skips the write if the serialized result exceeds the size guard (e.g. a heavy budget's
 * unbounded transaction list) — that call just goes uncached.
 */
export declare function put_cached_result<TResult>(collection: string, doc_id: string, data_version: number, result: TResult): Promise<void>;
//# sourceMappingURL=derived_result_cache.repo.d.ts.map