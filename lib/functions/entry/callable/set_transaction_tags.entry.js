"use strict";
/**
 * set_transaction_tags — onCall entry to apply tags to a transaction (owner only).
 *
 * All tags live at the split level. `split_id` null ⇒ set every split's tags (whole-transaction
 * case, common for single-split txns); a value ⇒ set that one split (multi-split advanced). The
 * repository recomputes the top-level `tagIds` union used by array-contains filtering + strip.
 *
 * The FE cannot write `transactions` directly (owner-read rules), so this is the write path.
 *
 * @module entry/callable/set_transaction_tags
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.set_transaction_tags = void 0;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const tags_repo_1 = require("../../repositories/tags.repo");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const tags_crud_types_1 = require("../../types/tags_crud.types");
exports.set_transaction_tags = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ maxInstances: 20 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(false);
    const parsed = tags_crud_types_1.set_transaction_tags_input_schema.safeParse(request.data);
    if (!parsed.success) {
        throw new https_1.HttpsError("invalid-argument", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const { transaction_id, split_id, tag_ids } = parsed.data;
    // Reject tag ids that aren't in the user's catalog (prevents dangling ids on docs).
    if (tag_ids.length > 0) {
        const catalog = await tags_repo_1.tags_repo.list_tags(ctx, user_id);
        const owned = new Set(catalog.map((t) => t.id));
        const unknown = tag_ids.filter((id) => !owned.has(id));
        if (unknown.length > 0) {
            throw new https_1.HttpsError("invalid-argument", `Unknown tag id(s): ${unknown.join(", ")}`);
        }
    }
    const raw = await transaction_repo_1.transaction_repo.get_raw_by_id(ctx, transaction_id);
    if (!raw) {
        throw new https_1.HttpsError("not-found", "Transaction not found");
    }
    const owner = ((_a = raw.data.userId) !== null && _a !== void 0 ? _a : raw.data.ownerId);
    if (owner !== user_id) {
        throw new https_1.HttpsError("permission-denied", "Not your transaction");
    }
    await transaction_repo_1.transaction_repo.write_split_tags(ctx, transaction_id, raw.data.splits, split_id !== null && split_id !== void 0 ? split_id : null, tag_ids);
    return { success: true };
});
//# sourceMappingURL=set_transaction_tags.entry.js.map