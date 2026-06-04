"use strict";
/**
 * Refresh Plaid Data Resolver
 *
 * Resolves dependencies for the combined balance + transaction sync.
 * This is primarily a delegation to the balance sync resolver with
 * additional context for transaction sync.
 *
 * @module resolvers/plaid/refresh_plaid_data
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_refresh_dependencies = resolve_refresh_dependencies;
const firestore_1 = require("firebase-admin/firestore");
const encryption_1 = require("../../../utils/encryption");
/** Rate limit window in seconds (5 minutes) */
const RATE_LIMIT_SECONDS = 300;
/**
 * Resolves dependencies for the refresh operation.
 *
 * Fetches:
 * - Plaid items for the user
 * - User context (group_ids, family_id, currency)
 * - Rate limit status for each item
 *
 * @param ctx - Trace context
 * @param input - Resolver input
 * @returns Dependencies or null if user has no items
 */
async function resolve_refresh_dependencies(ctx, input) {
    const db = (0, firestore_1.getFirestore)();
    const now = firestore_1.Timestamp.now();
    console.log(`[${ctx.trace_id}] Resolving refresh dependencies for user ${input.user_id}`);
    // 1. Fetch Plaid items
    let items_query = db
        .collection("plaid_items")
        .where("userId", "==", input.user_id)
        .where("status", "==", "active");
    if (input.item_id) {
        items_query = items_query.where("plaidItemId", "==", input.item_id);
    }
    const items_snapshot = await items_query.get();
    if (items_snapshot.empty) {
        console.log(`[${ctx.trace_id}] No Plaid items found for user`);
        return null;
    }
    // 2. Fetch user document for context
    const user_doc = await db.collection("users").doc(input.user_id).get();
    const user_data = user_doc.data();
    const user_context = {
        group_ids: (user_data === null || user_data === void 0 ? void 0 : user_data.groupIds) || [],
        family_id: (user_data === null || user_data === void 0 ? void 0 : user_data.familyId) || null,
        currency: (user_data === null || user_data === void 0 ? void 0 : user_data.currency) || "USD",
    };
    // 3. Build items list with decrypted tokens and check rate limits
    const items = [];
    const rate_limited_items = [];
    for (const doc of items_snapshot.docs) {
        const data = doc.data();
        const item_id = data.plaidItemId;
        // Check rate limit
        const last_sync = data.lastSyncAt;
        if (last_sync) {
            const seconds_since = now.seconds - last_sync.seconds;
            if (seconds_since < RATE_LIMIT_SECONDS) {
                rate_limited_items.push(item_id);
                console.log(`[${ctx.trace_id}] Item ${item_id} rate limited (${seconds_since}s since last sync)`);
                continue;
            }
        }
        // Decrypt access token
        try {
            const access_token = (0, encryption_1.decryptAccessToken)(data.encryptedAccessToken);
            items.push({
                item_id,
                doc_id: doc.id,
                access_token,
                institution_name: data.institutionName || "Unknown",
            });
        }
        catch (error) {
            console.error(`[${ctx.trace_id}] Failed to decrypt token for item ${item_id}:`, error);
            // Skip this item but continue with others
        }
    }
    console.log(`[${ctx.trace_id}] Resolved ${items.length} items to sync, ${rate_limited_items.length} rate limited`);
    return {
        items,
        user_context,
        rate_limited_items,
    };
}
//# sourceMappingURL=refresh_plaid_data.resolver.js.map