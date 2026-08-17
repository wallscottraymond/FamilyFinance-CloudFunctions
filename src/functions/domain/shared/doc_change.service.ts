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
export function changed_keys(
  before: Record<string, unknown> | undefined | null,
  after: Record<string, unknown> | undefined | null
): string[] {
  const b = before ?? {};
  const a = after ?? {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const out: string[] = [];
  for (const k of keys) {
    if (JSON.stringify((b as Record<string, unknown>)[k]) !== JSON.stringify((a as Record<string, unknown>)[k])) {
      out.push(k);
    }
  }
  return out;
}

/**
 * True when EVERY changed key is in `ignore` (nothing meaningful changed) — the
 * caller should skip. Empty diff also returns true. SAFE by construction: a
 * genuinely-relevant field change puts a non-ignored key in the diff → false.
 */
export function only_ignored_changed(
  before: Record<string, unknown> | undefined | null,
  after: Record<string, unknown> | undefined | null,
  ignore: readonly string[]
): boolean {
  const ig = new Set(ignore);
  return changed_keys(before, after).every((k) => ig.has(k));
}

/**
 * Bookkeeping fields that never affect a user_summary / cross-period sync. A
 * write touching ONLY these is a no-op for the period/summary triggers.
 */
export const PERIOD_SUMMARY_IGNORE_FIELDS: readonly string[] = [
  "updatedAt",
  "updatedBy",
  "lastCalculated",
  "lastSyncedAt",
  "accessibleBy",
  "memberIds",
];
