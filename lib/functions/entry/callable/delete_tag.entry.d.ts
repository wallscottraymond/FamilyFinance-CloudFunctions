/**
 * delete_tag — onCall entry to delete a catalog tag (owner only).
 *
 * Bounded-batch strip: removes the tag id from every tagged transaction (`split.tags` + the
 * denormalized `tagIds`), budget (`tags`), and rule (`has tag` conditions + `add_tag` actions),
 * then deletes the catalog doc.
 *
 * @module entry/callable/delete_tag
 */
export declare const delete_tag: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: true;
    stripped: {
        transactions: number;
        budgets: number;
        rules: number;
    };
}>, unknown>;
//# sourceMappingURL=delete_tag.entry.d.ts.map