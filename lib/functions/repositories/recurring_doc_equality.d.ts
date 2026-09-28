/**
 * Recurring-doc write-skip check (read/write-cost).
 *
 * `outflow_repo.save_batch` / `inflow_repo.save_batch` run on EVERY per-item recurring sync
 * (4 cycles/day) and used to `set()` every stream unconditionally with a fresh
 * `updatedAt`/`lastSyncedAt` — firing `on_recurring_updated` (derive-version bump +
 * reconcile enqueue + audit) for dozens of streams whose Plaid data hadn't changed, which
 * also invalidated every cached derived period.
 *
 * A write is skipped only when the document it would `set()` is IDENTICAL to the stored
 * one apart from the sync timestamps — same key set, same values (Timestamps by instant,
 * arrays in order). Anything else (including a stored field the new doc would drop) still
 * writes exactly as before. PURE.
 *
 * @module repositories/recurring_doc_equality
 */
/** True when writing `next` over `stored` would change nothing but the sync timestamps. */
export declare function is_unchanged_recurring_doc(stored: object, next: object): boolean;
//# sourceMappingURL=recurring_doc_equality.d.ts.map