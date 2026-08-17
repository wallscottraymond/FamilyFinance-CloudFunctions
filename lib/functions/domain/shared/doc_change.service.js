"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERIOD_SUMMARY_IGNORE_FIELDS = void 0;
exports.changed_keys = changed_keys;
exports.only_ignored_changed = only_ignored_changed;
/** Keys whose value differs between `before` and `after` (JSON-compared). PURE. */
function changed_keys(before, after) {
    const b = before !== null && before !== void 0 ? before : {};
    const a = after !== null && after !== void 0 ? after : {};
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    const out = [];
    for (const k of keys) {
        if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) {
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
function only_ignored_changed(before, after, ignore) {
    const ig = new Set(ignore);
    return changed_keys(before, after).every((k) => ig.has(k));
}
/**
 * Bookkeeping fields that never affect a user_summary / cross-period sync. A
 * write touching ONLY these is a no-op for the period/summary triggers.
 */
exports.PERIOD_SUMMARY_IGNORE_FIELDS = [
    "updatedAt",
    "updatedBy",
    "lastCalculated",
    "lastSyncedAt",
    "accessibleBy",
    "memberIds",
];
//# sourceMappingURL=doc_change.service.js.map