"use strict";
/**
 * Initial Sync Resolver
 *
 * Gathers dependencies for the initial sync orchestrator.
 * - Fetches plaid_item and decrypts access token
 * - Accounts start private (no group ids)
 * - Builds institution info for account creation
 *
 * @module resolvers/plaid/initial_sync
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_initial_sync_dependencies = resolve_initial_sync_dependencies;
const encryption_1 = require("../../../utils/encryption");
const plaid_1 = require("../../repositories/plaid");
/**
 * Resolves dependencies needed for the initial sync orchestrator.
 *
 * This resolver:
 * 1. Fetches the plaid_item document
 * 2. Decrypts the access token
 * 3. Leaves group_ids empty (accounts start private)
 * 4. Builds institution info
 *
 * @param ctx - Trace context
 * @param input - Initial sync input
 * @returns Dependencies for the orchestrator
 */
async function resolve_initial_sync_dependencies(ctx, input) {
    // Fetch plaid_item document (raw — we read accessToken/cursor)
    const item = await plaid_1.plaid_item_repo.get_raw_by_id(ctx, input.item_doc_id);
    if (!item) {
        throw new Error(`Plaid item not found: ${input.item_doc_id}`);
    }
    const item_data = item.data;
    // Decrypt access token
    const encrypted_token = item_data.accessToken;
    if (!encrypted_token) {
        throw new Error(`Plaid item has no access token: ${input.item_doc_id}`);
    }
    let access_token;
    try {
        access_token = (0, encryption_1.decryptAccessToken)(encrypted_token);
    }
    catch (error) {
        throw new Error(`Failed to decrypt access token for item: ${input.item_doc_id}`);
    }
    // Accounts start private (Account-Rooted-Sharing P1): sharing comes from an
    // account's placement, never from stamping the user's groups onto synced data.
    const group_ids = [];
    // Build institution info
    const institution = {
        institution_id: input.institution_id,
        name: input.institution_name,
    };
    console.log(`[${ctx.trace_id}] Resolved initial sync dependencies for item ${input.plaid_item_id}: ` +
        `cursor=${item_data.cursor || "null"}, groups=${group_ids.length}`);
    return {
        plaid_item: {
            id: input.item_doc_id,
            access_token,
            cursor: item_data.cursor || null,
        },
        group_ids,
        institution,
    };
}
//# sourceMappingURL=initial_sync.resolver.js.map