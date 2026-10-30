/**
 * On Category Written (Trigger) — canon O1: a Plaid code moved to another first category.
 *
 * The `categories` collection is the translation layer (canon §0). When a doc's `firstCategoryId`
 * changes (or a doc is added / (de)activated), every transaction carrying that code may now
 * belong to another budget. Plaid codes live only inside split maps (no query path), so each
 * user gets ONE bounded re-assign run — scheduled by ONE fan-out per burst of edits (a bulk
 * upload of ~100 docs included), delayed past the 5-minute category cache.
 * Cosmetic edits (display names, icons, keywords order…) don't re-assign anything.
 *
 * Per-collection document path (never a wildcard collection segment — see the trigger-cost rule).
 *
 * @module entry/triggers/on_category_written
 */
/** Pure: did this write change the code → category mapping? */
export declare function category_mapping_changed(before: Record<string, unknown> | null, after: Record<string, unknown> | null): boolean;
export declare const on_category_written: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").DocumentSnapshot> | undefined, {
    categoryId: string;
}>>;
//# sourceMappingURL=on_category_written.trigger.d.ts.map