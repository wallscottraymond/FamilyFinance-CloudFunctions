/**
 * delete_tag — onCall entry to delete a catalog tag (owner only).
 *
 * NOTE: stripping the tag id from tagged transactions/budgets/rules is added in later phases (once
 * the denormalized `tagIds`, budget tags, and rule tag-refs exist to strip). For now this deletes
 * the catalog doc; any not-yet-existent references get handled by that later bounded-batch strip.
 *
 * @module entry/callable/delete_tag
 */
export declare const delete_tag: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: true;
}>, unknown>;
//# sourceMappingURL=delete_tag.entry.d.ts.map