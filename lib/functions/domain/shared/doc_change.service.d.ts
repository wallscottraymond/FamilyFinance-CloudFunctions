/**
 * Document-change guards (PURE)
 *
 * Cheap, in-memory before/after diff helpers so a Firestore trigger can bail out
 * on a write that changed nothing it cares about — BEFORE doing any IO
 * (idempotency reads, job enqueues). This is the fix for per-document triggers
 * firing (and doing 2–3 Firestore ops each) on bookkeeping-only writes such as
 * `updatedAt`/`accessibleBy` touches or bulk re-saves.
 *
 * @module domain/shared/doc_change
 */
/** Keys whose value differs between `before` and `after` (JSON-compared). PURE. */
export declare function changed_keys(before: Record<string, unknown> | undefined | null, after: Record<string, unknown> | undefined | null): string[];
/**
 * True when EVERY changed key is in `ignore` (nothing meaningful changed) — the
 * caller should skip. Empty diff also returns true. SAFE by construction: a
 * genuinely-relevant field change puts a non-ignored key in the diff → false.
 */
export declare function only_ignored_changed(before: Record<string, unknown> | undefined | null, after: Record<string, unknown> | undefined | null, ignore: readonly string[]): boolean;
/**
 * Bookkeeping fields that never affect a user_summary / cross-period sync. A
 * write touching ONLY these is a no-op for the period/summary triggers.
 */
export declare const PERIOD_SUMMARY_IGNORE_FIELDS: readonly string[];
//# sourceMappingURL=doc_change.service.d.ts.map