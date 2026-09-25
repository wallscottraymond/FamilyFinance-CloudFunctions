"use strict";
/**
 * delete_tag — onCall entry to delete a catalog tag (owner only).
 *
 * Bounded-batch strip: removes the tag id from every tagged transaction (`split.tags` + the
 * denormalized `tagIds`), budget (`tags`), and rule (`has tag` conditions + `add_tag` actions),
 * then deletes the catalog doc.
 *
 * @module entry/callable/delete_tag
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.delete_tag = void 0;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const tags_repo_1 = require("../../repositories/tags.repo");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const budget_repo_1 = require("../../repositories/budget.repo");
const rules_repo_1 = require("../../repositories/rules.repo");
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
    // Strip references BEFORE deleting the catalog doc so a mid-way failure leaves the tag
    // recoverable (still in the catalog) rather than orphaned ids on docs.
    const transactions = await transaction_repo_1.transaction_repo.strip_tag(ctx, user_id, parsed.data.tag_id);
    const budgets = await budget_repo_1.budget_repo.strip_tag(ctx, user_id, parsed.data.tag_id);
    const rules = await rules_repo_1.rules_repo.strip_tag(ctx, user_id, parsed.data.tag_id);
    await tags_repo_1.tags_repo.delete_tag(ctx, parsed.data.tag_id);
    return { success: true, stripped: { transactions, budgets, rules } };
});
//# sourceMappingURL=delete_tag.entry.js.map