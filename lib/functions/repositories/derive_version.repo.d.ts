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
 * changes derive inputs. Idempotent-enough: over-bumping is harmless; the point is that
 * the version STRICTLY CHANGES after a write so the cache misses and recomputes.
 */
export declare function bump_derive_version(user_id: string): Promise<void>;
//# sourceMappingURL=derive_version.repo.d.ts.map