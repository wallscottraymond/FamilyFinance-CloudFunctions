"use strict";
/**
 * create_tag — onCall entry to create a catalog tag (unique case-insensitive name, per-user cap).
 *
 * @module entry/callable/create_tag
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.create_tag = void 0;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const tags_repo_1 = require("../../repositories/tags.repo");
const tags_crud_types_1 = require("../../types/tags_crud.types");
exports.create_tag = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ maxInstances: 20 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(false);
    const parsed = tags_crud_types_1.create_tag_input_schema.safeParse(request.data);
    if (!parsed.success) {
        throw new https_1.HttpsError("invalid-argument", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const name = parsed.data.name.trim();
    const existing = await tags_repo_1.tags_repo.list_tags(ctx, user_id);
    if (existing.length >= tags_crud_types_1.MAX_TAGS_PER_USER) {
        throw new https_1.HttpsError("resource-exhausted", `Tag limit reached (${tags_crud_types_1.MAX_TAGS_PER_USER}).`);
    }
    if (existing.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
        throw new https_1.HttpsError("already-exists", "A tag with that name already exists.");
    }
    const tag_id = await tags_repo_1.tags_repo.create_tag(ctx, user_id, {
        name,
        color: parsed.data.color,
    });
    return { tag_id };
});
//# sourceMappingURL=create_tag.entry.js.map