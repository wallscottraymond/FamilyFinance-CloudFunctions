"use strict";
/**
 * Re-authentication Item Resolver
 *
 * READ-ONLY: loads Plaid items needing re-authentication with their decrypted
 * access tokens, for the recovery probe. No mutations.
 *
 * @module resolvers/plaid/reauth_item
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_reauth_item = resolve_reauth_item;
exports.resolve_reauth_items_to_probe = resolve_reauth_items_to_probe;
const observability_1 = require("../../observability");
const plaid_item_repo_1 = require("../../repositories/plaid/plaid_item.repo");
const encryption_1 = require("../../../utils/encryption");
const reauth_recovery_types_1 = require("../../types/plaid/reauth_recovery.types");
/**
 * Decrypts a stored token; null when missing or undecryptable.
 */
function decrypt_or_null(ctx, item_doc_id, encrypted) {
    if (typeof encrypted !== "string" || encrypted.length === 0) {
        return null;
    }
    try {
        return (0, encryption_1.decryptAccessToken)(encrypted);
    }
    catch (error) {
        console.error(`[${ctx.trace_id}] Failed to decrypt access token for item ${item_doc_id}:`, error);
        return null;
    }
}
/**
 * Resolves one item by document ID.
 *
 * @param ctx - Trace context
 * @param item_doc_id - Plaid item document ID
 * @returns The item, or null when it doesn't exist
 */
async function resolve_reauth_item(ctx, item_doc_id) {
    const span = (0, observability_1.create_span)(ctx, "resolver", "resolve_reauth_item");
    (0, observability_1.log_operation_start)(span, "system");
    const raw = await plaid_item_repo_1.plaid_item_repo.get_raw_by_id(ctx, item_doc_id);
    if (!raw) {
        (0, observability_1.log_operation_success)(span, "system");
        return null;
    }
    const data = raw.data;
    const item = {
        item_doc_id: raw.id,
        plaid_item_id: data.plaidItemId,
        user_id: data.userId,
        status: data.status || "good",
        is_active: data.isActive !== false,
        access_token: decrypt_or_null(ctx, raw.id, data.accessToken),
    };
    (0, observability_1.log_operation_success)(span, "system");
    return item;
}
/**
 * Resolves every active item currently needing re-authentication (capped).
 *
 * @param ctx - Trace context
 * @returns Items to probe
 */
async function resolve_reauth_items_to_probe(ctx) {
    const span = (0, observability_1.create_span)(ctx, "resolver", "resolve_reauth_items_to_probe");
    (0, observability_1.log_operation_start)(span, "system");
    // Same status query the transient-retry job uses; it already skips inactive items.
    const rows = await plaid_item_repo_1.plaid_item_repo.get_in_transient_state(ctx, reauth_recovery_types_1.REAUTH_STATUSES);
    const items = [];
    for (const row of rows.slice(0, reauth_recovery_types_1.MAX_REAUTH_PROBES_PER_RUN)) {
        const item = await resolve_reauth_item(ctx, row.item_doc_id);
        if (item && item.is_active) {
            items.push(item);
        }
    }
    (0, observability_1.log_operation_success)(span, "system");
    return items;
}
//# sourceMappingURL=reauth_item.resolver.js.map