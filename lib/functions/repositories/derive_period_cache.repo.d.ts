/**
 * Derived-Period Cache Repository
 *
 * L2 (server) cache for `derive_period` ([[Firestore-Read-Cost-Reduction]]). One doc per
 * (user, view-cadence, window) holds the fully-computed `DerivePeriodResult` plus the
 * `data_version` it was computed at and `computed_at_ms`.
 *
 * `derive_period` reads this + the user's current `data_version` (2 reads). If the doc's
 * `data_version` matches AND it's within the TTL backstop, it returns the cached result —
 * skipping the ~9-collection fan-out + in-memory derivation. Otherwise it recomputes and
 * overwrites the doc. The TTL is a SAFETY net only: correctness comes from the version
 * match; the TTL bounds staleness (to minutes, not forever) if some write path forgot to
 * bump the version.
 *
 * No raw transactions are stored — the result is already aggregated (budgets/bills/income
 * occurrences), so docs are tens of KB. A size guard skips caching any pathological result.
 *
 * @module repositories/derive_period_cache
 */
import { Timestamp } from "firebase-admin/firestore";
export interface CachedDerivedPeriod<TResult> {
    data_version: number;
    computed_at_ms: number;
    /** TTL field: Firestore auto-deletes the cache entry once past (= computed_at + retention). */
    expire_at: Timestamp;
    result: TResult;
}
/** Read the cached derived period for this exact call, or null. 1 read. */
export declare function get_cached_derived_period<TResult>(user_id: string, view_cadence: string, window_start_ms: number, window_end_ms: number): Promise<CachedDerivedPeriod<TResult> | null>;
/**
 * Store a freshly-computed derived period, stamped with the version it was computed at.
 * Fire-and-forget from the orchestrator (a failed cache write must never fail the derive).
 * Skips the write if the serialized result is implausibly large (guard).
 */
export declare function put_cached_derived_period<TResult>(user_id: string, view_cadence: string, window_start_ms: number, window_end_ms: number, data_version: number, result: TResult): Promise<void>;
//# sourceMappingURL=derive_period_cache.repo.d.ts.map