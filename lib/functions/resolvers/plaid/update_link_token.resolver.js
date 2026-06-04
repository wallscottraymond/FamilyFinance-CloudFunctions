"use strict";
/**
 * Update Link Token Resolver
 *
 * Gathers dependencies needed for update link token creation.
 * READ-ONLY operations - no mutations.
 *
 * @module resolvers/plaid/update_link_token
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_update_link_token_dependencies = resolve_update_link_token_dependencies;
const firestore_1 = require("firebase-admin/firestore");
const update_link_token_types_1 = require("../../types/plaid/update_link_token.types");
const encryption_1 = require("../../../utils/encryption");
const observability_1 = require("../../observability");
/**
 * Gets the Firestore instance.
 */
function get_db() {
    return (0, firestore_1.getFirestore)();
}
/**
 * Resolves dependencies for update link token creation.
 *
 * Gathers:
 * - Plaid item by ID
 * - Decrypted access token
 * - User profile (display name, email)
 * - Ownership verification
 * - Recent relink attempt count
 *
 * @param ctx - Trace context
 * @param input - Resolution input
 * @returns Resolved dependencies
 */
async function resolve_update_link_token_dependencies(ctx, input) {
    const span = (0, observability_1.create_span)(ctx, "resolver", "resolve_update_link_token_dependencies");
    (0, observability_1.log_operation_start)(span, input.user_id);
    const db = get_db();
    // 1. Fetch Plaid item by document ID
    const item_doc = await db.collection("plaid_items").doc(input.item_id).get();
    if (!item_doc.exists) {
        (0, observability_1.log_operation_success)(span, input.user_id);
        return {
            plaid_item: null,
            access_token: null,
            item_found: false,
            user_owns_item: false,
            user_display_name: "Family Finance User",
            user_email: null,
            recent_relink_attempts: 0,
        };
    }
    const item_data = item_doc.data();
    // Check ownership
    const user_owns_item = item_data.userId === input.user_id;
    // Build plaid_item object
    const plaid_item = {
        id: item_doc.id,
        plaid_item_id: item_data.plaidItemId,
        user_id: item_data.userId,
        institution_id: item_data.institutionId || "",
        institution_name: item_data.institutionName || "Unknown Institution",
        status: (item_data.status || "good"),
        error: item_data.error || null,
        is_active: item_data.isActive !== false, // Default to true if undefined
    };
    // 2. Decrypt access token
    let access_token = null;
    const encrypted_token = item_data.accessToken;
    if (encrypted_token && user_owns_item) {
        try {
            access_token = (0, encryption_1.decryptAccessToken)(encrypted_token);
        }
        catch (error) {
            console.error(`[${ctx.trace_id}] Failed to decrypt access token for item ${input.item_id}:`, error);
            // access_token stays null, indicating decryption failure
        }
    }
    // 3. Fetch user profile
    let user_display_name = "Family Finance User";
    let user_email = null;
    if (user_owns_item) {
        try {
            const user_doc = await db.collection("users").doc(input.user_id).get();
            if (user_doc.exists) {
                const user_data = user_doc.data();
                user_display_name = user_data.displayName || user_data.name || "Family Finance User";
                user_email = user_data.email || null;
            }
        }
        catch (error) {
            console.warn(`[${ctx.trace_id}] Failed to fetch user profile for ${input.user_id}:`, error);
            // Continue with defaults
        }
    }
    // 4. Count recent relink attempts
    let recent_relink_attempts = 0;
    try {
        const window_start = firestore_1.Timestamp.fromDate(new Date(Date.now() - update_link_token_types_1.RELINK_ATTEMPT_WINDOW_HOURS * 60 * 60 * 1000));
        const attempts_snapshot = await db
            .collection("relink_attempts")
            .where("user_id", "==", input.user_id)
            .where("item_id", "==", input.item_id)
            .where("created_at", ">=", window_start)
            .get();
        recent_relink_attempts = attempts_snapshot.size;
    }
    catch (error) {
        console.warn(`[${ctx.trace_id}] Failed to count relink attempts:`, error);
        // Continue with 0 - don't block user due to tracking failure
    }
    (0, observability_1.log_operation_success)(span, input.user_id);
    return {
        plaid_item,
        access_token,
        item_found: true,
        user_owns_item,
        user_display_name,
        user_email,
        recent_relink_attempts,
    };
}
//# sourceMappingURL=update_link_token.resolver.js.map