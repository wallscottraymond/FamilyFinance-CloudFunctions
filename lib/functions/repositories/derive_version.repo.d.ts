/**
 * Derive-Version Repository
 *
 * A per-user monotonic `version` counter that changes whenever ANY data feeding
 * `derive_period` changes (bills/income/budgets/goals/transactions/periods/…). It is
 * the invalidation signal for the derived-period cache ([[Firestore-Read-Cost-Reduction]]):
 * `derive_period` returns the cached result iff its stamped version matches the current one.
 *
 * `bump_derive_version` is `FieldValue.increment(1)` — no read, commutative, so callers
 * fire-and-forget it from write paths. A burst of writes may contend on the single doc;
 * that's harmless: any one success invalidates the cache, and over-bumping only costs a
 * (rare) extra recompute. A short TTL backstop in the cache bounds any missed-bump path.
 *
 * @module repositories/derive_version
 */
/** Current derive-input version for a user (0 if never written). 1 read. */
export declare function get_derive_version(user_id: string): Promise<number>;
/**
 * Bump a user's derive-input version. Call (fire-and-forget) from any write path that
 * changes derive inputs. Direct increment (NOT debounced): a debounced bump would delay
 * invalidation, so the editor's own post-edit re-derive would hit a still-valid stale
 * cache and the change would visually revert until the bump landed. Freshness wins here;
 * the churn COST is addressed by reducing how many cards re-derive per invalidation.
 */
export declare function bump_derive_version(user_id: string): Promise<void>;
//# sourceMappingURL=derive_version.repo.d.ts.map