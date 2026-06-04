"use strict";
/**
 * Item Status Webhook Resolver
 *
 * Gathers dependencies for item status webhook processing.
 * Looks up the Plaid item by Plaid's item ID (not our document ID).
 *
 * @module resolvers/plaid/item_status_webhook
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_item_status_webhook_dependencies = resolve_item_status_webhook_dependencies;
const firestore_1 = require("firebase-admin/firestore");
/**
 * Resolves dependencies for item status webhook processing.
 *
 * @param ctx - Trace context
 * @param input - Resolution input with Plaid item ID
 * @returns Resolved dependencies
 */
async function resolve_item_status_webhook_dependencies(ctx, input) {
    const db = (0, firestore_1.getFirestore)();
    // Look up item by Plaid's item ID (stored as plaidItemId)
    const items_snapshot = await db
        .collection("plaid_items")
        .where("plaidItemId", "==", input.plaid_item_id)
        .where("isActive", "==", true)
        .limit(1)
        .get();
    if (items_snapshot.empty) {
        console.log(`[${ctx.trace_id}] No active item found for Plaid item ID: ${input.plaid_item_id}`);
        return {
            item_found: false,
            item_doc_id: null,
            user_id: null,
            current_status: null,
            is_active: false,
            institution_name: null,
        };
    }
    const item_doc = items_snapshot.docs[0];
    const item_data = item_doc.data();
    console.log(`[${ctx.trace_id}] Found item ${item_doc.id} for Plaid item ID: ${input.plaid_item_id}`);
    return {
        item_found: true,
        item_doc_id: item_doc.id,
        user_id: item_data.userId,
        current_status: item_data.status || "good",
        is_active: item_data.isActive !== false,
        institution_name: item_data.institutionName || null,
    };
}
//# sourceMappingURL=item_status_webhook.resolver.js.map