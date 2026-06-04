"use strict";
/**
 * Balance Sync Resolver
 *
 * Gathers dependencies for the balance sync orchestrator.
 * - Fetches plaid_items and decrypts access tokens
 * - Fetches local accounts for balance comparison
 *
 * @module resolvers/plaid/balance_sync
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_balance_sync_dependencies = resolve_balance_sync_dependencies;
const firestore_1 = require("firebase-admin/firestore");
const encryption_1 = require("../../../utils/encryption");
/**
 * Resolves dependencies needed for the balance sync orchestrator.
 *
 * This resolver:
 * 1. Fetches active plaid_items for the user (or specific item)
 * 2. Decrypts access tokens
 * 3. Fetches local accounts grouped by item for matching
 *
 * @param ctx - Trace context
 * @param input - Balance sync input
 * @returns Dependencies for the orchestrator
 */
async function resolve_balance_sync_dependencies(ctx, input) {
    var _a, _b;
    const db = (0, firestore_1.getFirestore)();
    // Step 1: Fetch plaid_items
    let items_query = db.collection("plaid_items")
        .where("userId", "==", input.user_id)
        .where("isActive", "==", true);
    if (input.item_id) {
        items_query = items_query.where("plaidItemId", "==", input.item_id);
    }
    const items_snapshot = await items_query.get();
    const items = [];
    for (const doc of items_snapshot.docs) {
        const data = doc.data();
        const encrypted_token = data.accessToken;
        if (!encrypted_token) {
            console.warn(`[${ctx.trace_id}] Plaid item ${doc.id} has no access token, skipping`);
            continue;
        }
        try {
            const access_token = (0, encryption_1.decryptAccessToken)(encrypted_token);
            items.push({
                item_id: data.plaidItemId,
                access_token,
                institution_id: data.institutionId || "",
                institution_name: data.institutionName || "Unknown Institution",
                group_id: (_a = data.groupIds) === null || _a === void 0 ? void 0 : _a[0], // First group ID for sharing
            });
        }
        catch (error) {
            console.error(`[${ctx.trace_id}] Failed to decrypt access token for item ${doc.id}:`, error);
        }
    }
    // Step 2: Fetch local accounts
    let accounts_query = db.collection("accounts")
        .where("userId", "==", input.user_id)
        .where("isActive", "==", true);
    // Filter by specific account IDs if provided
    // Note: Firestore "in" query limited to 30 items
    if (input.account_ids && input.account_ids.length > 0) {
        // For large lists, we'll filter in-memory after fetch
        // This is acceptable since users typically have < 50 accounts
    }
    const accounts_snapshot = await accounts_query.get();
    // Group accounts by item_id
    const accounts_by_item = new Map();
    let total_accounts = 0;
    for (const doc of accounts_snapshot.docs) {
        const data = doc.data();
        const item_id = data.itemId;
        const plaid_account_id = data.plaidAccountId || data.accountId;
        // Skip if filtering by account_ids and this account not in list
        if (input.account_ids && input.account_ids.length > 0) {
            if (!input.account_ids.includes(plaid_account_id)) {
                continue;
            }
        }
        // Skip if filtering by item_id and this account belongs to different item
        if (input.item_id && item_id !== input.item_id) {
            continue;
        }
        if (!accounts_by_item.has(item_id)) {
            accounts_by_item.set(item_id, []);
        }
        accounts_by_item.get(item_id).push({
            id: doc.id,
            plaid_account_id,
            current_balance: (_b = data.currentBalance) !== null && _b !== void 0 ? _b : 0,
        });
        total_accounts++;
    }
    console.log(`[${ctx.trace_id}] Resolved balance sync dependencies: ` +
        `${items.length} items, ${total_accounts} accounts`);
    return {
        items,
        accounts_by_item,
        total_accounts,
    };
}
//# sourceMappingURL=balance_sync.resolver.js.map