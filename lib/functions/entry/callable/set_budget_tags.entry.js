"use strict";
/**
 * set_budget_tags — onCall entry to apply tags to a budget (owner only).
 *
 * Budgets store tags top-level (`tags`), directly queryable via array-contains.
 *
 * @module entry/callable/set_budget_tags
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.set_budget_tags = void 0;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const tags_repo_1 = require("../../repositories/tags.repo");
const budget_repo_1 = require("../../repositories/budget.repo");
const tags_crud_types_1 = require("../../types/tags_crud.types");
exports.set_budget_tags = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ maxInstances: 20 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(false);
    const parsed = tags_crud_types_1.set_budget_tags_input_schema.safeParse(request.data);
    if (!parsed.success) {
        throw new https_1.HttpsError("invalid-argument", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const { budget_id, tag_ids } = parsed.data;
    // Reject tag ids that aren't in the user's catalog (prevents dangling ids on docs).
    if (tag_ids.length > 0) {
        const catalog = await tags_repo_1.tags_repo.list_tags(ctx, user_id);
        const owned = new Set(catalog.map((t) => t.id));
        const unknown = tag_ids.filter((id) => !owned.has(id));
        if (unknown.length > 0) {
            throw new https_1.HttpsError("invalid-argument", `Unknown tag id(s): ${unknown.join(", ")}`);
        }
    }
    const budget = await budget_repo_1.budget_repo.get_by_id(ctx, budget_id);
    if (!budget) {
        throw new https_1.HttpsError("not-found", "Budget not found");
    }
    if (budget.user_id !== user_id) {
        throw new https_1.HttpsError("permission-denied", "Not your budget");
    }
    await budget_repo_1.budget_repo.set_tags(ctx, budget_id, tag_ids, user_id);
    return { success: true };
});
//# sourceMappingURL=set_budget_tags.entry.js.map