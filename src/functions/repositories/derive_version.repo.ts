/**
 * Derive-Version Repository
 *
 * A per-user monotonic `version` counter that changes whenever ANY data feeding
 * `derive_period` changes (bills/income/budgets/goals/transactions/periods/…). It is
 * the invalidation signal for the derived-period cache ([[Firestore-Read-Cost-Reduction]]):
 * `derive_period` returns the cached result iff its stamped version matches the current one.
 *
 * `bump_derive_version` is `FieldValue.increment(1)` — no read, commutative. Callers
 * AWAIT it (`.catch(() => {})`) AFTER their write commits: un-awaited work can be
 * dropped once a gen2 function returns, and a bump that lands before the write lets
 * a derive re-cache old data. A burst of writes may contend on the single doc;
 * that's harmless: any one success invalidates the cache, and over-bumping only costs a
 * (rare) extra recompute. The cache's 24h TTL backstop bounds any missed-bump path, so every
 * writer of a derive input must bump (audited 2026-10-08, [[Performance-Review-4]]).
 *
 * @module repositories/derive_version
 */

import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

const COLLECTION = "user_data_versions";

/** Current derive-input version for a user (0 if never written). 1 read. */
export async function get_derive_version(user_id: string): Promise<number> {
  const snap = await getFirestore().collection(COLLECTION).doc(user_id).get();
  return snap.exists ? ((snap.data()?.version as number) ?? 0) : 0;
}

/**
 * Bump a user's derive-input version. Await it from any write path that
 * changes derive inputs. Direct increment (NOT debounced): a debounced bump would delay
 * invalidation, so the editor's own post-edit re-derive would hit a still-valid stale
 * cache and the change would visually revert until the bump landed. Freshness wins here;
 * the churn COST is addressed by reducing how many cards re-derive per invalidation.
 */
export async function bump_derive_version(user_id: string): Promise<void> {
  if (!user_id) return;
  await getFirestore()
    .collection(COLLECTION)
    .doc(user_id)
    .set(
      { version: FieldValue.increment(1), updated_at: Timestamp.now() },
      { merge: true }
    );
}
