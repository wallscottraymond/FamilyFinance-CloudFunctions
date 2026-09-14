"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.get_cached_derived_period = get_cached_derived_period;
exports.put_cached_derived_period = put_cached_derived_period;
const firestore_1 = require("firebase-admin/firestore");
const COLLECTION = "derived_period_cache";
/** Firestore hard limit is ~1 MiB/doc; stay well under to leave headroom for metadata. */
const MAX_CACHE_DOC_BYTES = 800000;
/** Deterministic doc id for a derive call. Windows are ms epoch ints — safe in an id. */
function cache_doc_id(user_id, view_cadence, window_start_ms, window_end_ms) {
    return `${user_id}__${view_cadence}__${window_start_ms}__${window_end_ms}`;
}
/** Read the cached derived period for this exact call, or null. 1 read. */
async function get_cached_derived_period(user_id, view_cadence, window_start_ms, window_end_ms) {
    const snap = await (0, firestore_1.getFirestore)()
        .collection(COLLECTION)
        .doc(cache_doc_id(user_id, view_cadence, window_start_ms, window_end_ms))
        .get();
    if (!snap.exists)
        return null;
    return snap.data();
}
/**
 * Store a freshly-computed derived period, stamped with the version it was computed at.
 * Fire-and-forget from the orchestrator (a failed cache write must never fail the derive).
 * Skips the write if the serialized result is implausibly large (guard).
 */
async function put_cached_derived_period(user_id, view_cadence, window_start_ms, window_end_ms, data_version, result) {
    const doc = {
        data_version,
        computed_at_ms: firestore_1.Timestamp.now().toMillis(),
        result,
    };
    const approx_bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
    if (approx_bytes > MAX_CACHE_DOC_BYTES) {
        console.warn(`[derive_period_cache] Skipping cache for ${user_id} (${view_cadence}): ` +
            `result ~${approx_bytes}B exceeds ${MAX_CACHE_DOC_BYTES}B guard`);
        return;
    }
    await (0, firestore_1.getFirestore)()
        .collection(COLLECTION)
        .doc(cache_doc_id(user_id, view_cadence, window_start_ms, window_end_ms))
        .set(doc);
}
//# sourceMappingURL=derive_period_cache.repo.js.map