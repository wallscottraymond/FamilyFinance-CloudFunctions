/**
 * delete_tag — onCall entry to delete a catalog tag (owner only).
 *
 * Bounded-batch strip: removes the tag id from every tagged transaction (`split.tags` + the
 * denormalized `tagIds`) and budget (`tags`), then deletes the catalog doc. Rule tag-refs are
 * stripped in Phase 3 (once the Rule Book gains tag conditions/actions).
 *
 * @module entry/callable/delete_tag
 */
export declare const delete_tag: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: true;
    stripped: {
        transactions: number;
        budgets: number;
    };
}>, unknown>;
//# sourceMappingURL=delete_tag.entry.d.ts.map