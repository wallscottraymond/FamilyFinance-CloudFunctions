"use strict";
/**
 * delete_tag — onCall entry to delete a catalog tag (owner only).
 *
 * NOTE: stripping the tag id from tagged transactions/budgets/rules is added in later phases (once
 * the denormalized `tagIds`, budget tags, and rule tag-refs exist to strip). For now this deletes
 * the catalog doc; any not-yet-existent references get handled by that later bounded-batch strip.
 *
 * @module entry/callable/delete_tag
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.delete_tag = void 0;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const tags_repo_1 = require("../../repositories/tags.repo");
const tags_crud_types_1 = require("../../types/tags_crud.types");
exports.delete_tag = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ maxInstances: 20 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(false);
    const parsed = tags_crud_types_1.delete_tag_input_schema.safeParse(request.data);
    if (!parsed.success) {
        throw new https_1.HttpsError("invalid-argument", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const existing = await tags_repo_1.tags_repo.get_tag(ctx, parsed.data.tag_id);
    if (!existing) {
        throw new https_1.HttpsError("not-found", "Tag not found");
    }
    if (existing.user_id !== user_id) {
        throw new https_1.HttpsError("permission-denied", "Not your tag");
    }
    await tags_repo_1.tags_repo.delete_tag(ctx, parsed.data.tag_id);
    return { success: true };
});
//# sourceMappingURL=delete_tag.entry.js.map