"use strict";
/**
 * list_tags — onCall entry returning the caller's tag catalog, name-sorted.
 *
 * @module entry/callable/list_tags
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.list_tags = void 0;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const tags_repo_1 = require("../../repositories/tags.repo");
exports.list_tags = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ maxInstances: 20 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const ctx = (0, observability_1.create_trace_context)(false);
    const tags = await tags_repo_1.tags_repo.list_tags(ctx, request.auth.uid);
    return { tags };
});
//# sourceMappingURL=list_tags.entry.js.map