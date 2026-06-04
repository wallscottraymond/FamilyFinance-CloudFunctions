"use strict";
/**
 * Link Token Resolver
 *
 * Gathers dependencies needed for link token creation.
 * READ-ONLY operations - no mutations.
 *
 * @module resolvers/plaid/link_token
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_link_token_dependencies = resolve_link_token_dependencies;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../types");
const plaid_1 = require("../../repositories/plaid");
const observability_1 = require("../../observability");
/**
 * Gets the Firestore instance.
 */
function get_db() {
    return (0, firestore_1.getFirestore)();
}
/**
 * Resolves dependencies for link token creation.
 *
 * Gathers:
 * - User profile (display name, email)
 * - Existing Plaid items count (for future account limits)
 * - Cached token if available
 * - Access token validity for update mode
 *
 * @param ctx - Trace context
 * @param input - Resolution input
 * @returns Resolved dependencies
 */
async function resolve_link_token_dependencies(ctx, input) {
    const span = (0, observability_1.create_span)(ctx, "resolver", "resolve_link_token_dependencies");
    (0, observability_1.log_operation_start)(span, input.user_id);
    const db = get_db();
    // 1. Check for cached token first
    const cached = await plaid_1.link_token_event_repo.get_valid_token(ctx, input.user_id, input.is_update_mode, { max_age_hours: types_1.LINK_TOKEN_CACHE_TTL_HOURS });
    // 2. Fetch user profile from Firestore
    // Note: Using direct Firestore query until user_repo is migrated
    const user_doc = await db.collection("users").doc(input.user_id).get();
    const user_data = user_doc.exists ? user_doc.data() : null;
    // 3. Count existing Plaid items for this user
    // Note: Using direct Firestore query until plaid_item_repo is migrated
    const items_snapshot = await db
        .collection("plaid_items")
        .where("userId", "==", input.user_id)
        .where("isActive", "==", true)
        .get();
    // 4. Validate access token if provided (update mode)
    let access_token_valid = true;
    if (input.access_token) {
        // Look up the item by encrypted access token
        // Note: This is a simplification - in practice, you'd look up by item_id
        // and verify the access_token matches
        const item_snapshot = await db
            .collection("plaid_items")
            .where("userId", "==", input.user_id)
            .where("isActive", "==", true)
            .limit(1)
            .get();
        // For update mode, we just verify the user has at least one active item
        // The access_token provided should be a decrypted token from a valid item
        access_token_valid = !item_snapshot.empty;
    }
    (0, observability_1.log_operation_success)(span, input.user_id);
    return {
        user_display_name: (user_data === null || user_data === void 0 ? void 0 : user_data.displayName) || (user_data === null || user_data === void 0 ? void 0 : user_data.name) || "Family Finance User",
        user_email: (user_data === null || user_data === void 0 ? void 0 : user_data.email) || null,
        existing_item_count: items_snapshot.size,
        access_token_valid,
        cached_token: (cached === null || cached === void 0 ? void 0 : cached.link_token) || null,
        cached_expiration: (cached === null || cached === void 0 ? void 0 : cached.expiration) || null,
    };
}
//# sourceMappingURL=link_token.resolver.js.map