"use strict";
/**
 * update_tag — onCall entry to rename/recolor a tag (owner only; name stays unique).
 *
 * @module entry/callable/update_tag
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.update_tag = void 0;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const tags_repo_1 = require("../../repositories/tags.repo");
const tags_crud_types_1 = require("../../types/tags_crud.types");
exports.update_tag = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ maxInstances: 20 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(false);
    const parsed = tags_crud_types_1.update_tag_input_schema.safeParse(request.data);
    if (!parsed.success) {
        throw new https_1.HttpsError("invalid-argument", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const input = parsed.data;
    const existing = await tags_repo_1.tags_repo.get_tag(ctx, input.tag_id);
    if (!existing) {
        throw new https_1.HttpsError("not-found", "Tag not found");
    }
    if (existing.user_id !== user_id) {
        throw new https_1.HttpsError("permission-denied", "Not your tag");
    }
    if (input.name !== undefined) {
        const name = input.name.trim();
        const all = await tags_repo_1.tags_repo.list_tags(ctx, user_id);
        if (all.some((t) => t.id !== input.tag_id && t.name.toLowerCase() === name.toLowerCase())) {
            throw new https_1.HttpsError("already-exists", "A tag with that name already exists.");
        }
    }
    await tags_repo_1.tags_repo.update_tag(ctx, input.tag_id, {
        name: (_a = input.name) === null || _a === void 0 ? void 0 : _a.trim(),
        color: input.color,
    });
    return { success: true };
});
//# sourceMappingURL=update_tag.entry.js.map