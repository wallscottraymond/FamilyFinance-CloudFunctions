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
const derived_result_cache_repo_1 = require("./derived_result_cache.repo");
const COLLECTION = "derived_period_cache";
/** Firestore hard limit is ~1 MiB/doc; stay well under to leave headroom for metadata. */
const MAX_CACHE_DOC_BYTES = 800000;
/** Cache-entry retention (TTL). One doc per (user, cadence, window), so it grows as users
 *  navigate to more windows. Correctness is via version-match, not freshness — 7 days is far
 *  beyond any active session; past that Firestore auto-expires stale entries via `expire_at`
 *  (enable a TTL policy on `derived_period_cache.expire_at`). */
const CACHE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** Result SHAPE version, part of the doc id: bump whenever the derived result's shape changes
 *  so a cached result in the old shape is never served. v2 = paid occurrences carry
 *  `transaction_id` (Tappable-Transaction-Rows). v3 = Code-Health-Review batch 6 (partial-month
 *  pricing, quarterly/yearly per-month amounts): drop results computed with the old numbers. v4 =
 *  budget pause (isPaused / pausedDays on budget periods, PZ3). v5 = card payments are money
 *  movement, drop results that counted them (Trustworthy-Numbers D1). v6 = look-alike card sides,
 *  the 5-day wait (D7, D8). v7 = occurrences carry their expected amount (AF-08).
 *  v8 = a paused period's group carries its resume date (AF-03). v10 = budget periods carry
 *  `daily_spent` (per-day spend for the budget daily chart) + the spend breakdown `daily_count`,
 *  `places`, `fees`; budgets carry `first_category_ids` ("Easy to change" tips). v11 = places are
 *  top 8 by total ∪ top 8 by purchase count (up to 16) and each carries `code` (its most common
 *  resolved Plaid detailed code). v12 = income with parts: occurrences carry `parts` /
 *  `sure_amount`, income carries `part_stats` (Income-Detail-Screen).
 *  Every function bundling this repo (derive_period, derive_period_range, derive_budget_view,
 *  widget_snapshot) deploys together. */
const CACHE_SHAPE = "v12";
/** Deterministic doc id for a derive call, per UTC day: a result depends on the day only through a
 *  card payment's wait ending, which happens at UTC midnight and isn't a data change (D8). Windows are ms epoch ints — safe in an id. */
function cache_doc_id(user_id, view_cadence, window_start_ms, window_end_ms) {
    return `${user_id}__${view_cadence}__${window_start_ms}__${window_end_ms}__${CACHE_SHAPE}__${(0, derived_result_cache_repo_1.utc_day_key)()}`;
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
    const now_ms = firestore_1.Timestamp.now().toMillis();
    const doc = {
        data_version,
        computed_at_ms: now_ms,
        expire_at: firestore_1.Timestamp.fromMillis(now_ms + CACHE_RETENTION_MS),
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