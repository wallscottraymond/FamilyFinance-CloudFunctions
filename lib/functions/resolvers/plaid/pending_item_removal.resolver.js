"use strict";
/**
 * Pending Item Removal Resolver
 *
 * READ-ONLY: the Plaid items whose removal failed during an account removal,
 * with decrypted access tokens for the retry. No mutations.
 *
 * @module resolvers/plaid/pending_item_removal
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_pending_item_removals = resolve_pending_item_removals;
const observability_1 = require("../../observability");
const plaid_item_repo_1 = require("../../repositories/plaid/plaid_item.repo");
const encryption_1 = require("../../../utils/encryption");
/**
 * Resolves items flagged `removalPending`.
 *
 * @param ctx - Trace context
 * @returns Items to retry
 */
async function resolve_pending_item_removals(ctx) {
    const span = (0, observability_1.create_span)(ctx, "resolver", "resolve_pending_item_removals");
    (0, observability_1.log_operation_start)(span, "system");
    const rows = await plaid_item_repo_1.plaid_item_repo.get_pending_removal(ctx);
    const items = rows.map((row) => {
        let access_token = null;
        const encrypted = row.data.accessToken;
        if (typeof encrypted === "string" && encrypted.length > 0) {
            try {
                access_token = (0, encryption_1.decryptAccessToken)(encrypted);
            }
            catch (_a) {
                access_token = null;
            }
        }
        return { item_doc_id: row.id, user_id: row.data.userId, access_token };
    });
    (0, observability_1.log_operation_success)(span, "system");
    return items;
}
//# sourceMappingURL=pending_item_removal.resolver.js.map