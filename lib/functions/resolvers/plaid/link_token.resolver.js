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
const types_1 = require("../../types");
const plaid_1 = require("../../repositories/plaid");
const user_repo_1 = require("../../repositories/user.repo");
const observability_1 = require("../../observability");
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
    var _a;
    const span = (0, observability_1.create_span)(ctx, "resolver", "resolve_link_token_dependencies");
    (0, observability_1.log_operation_start)(span, input.user_id);
    // 1. Check for cached token first
    const cached = await plaid_1.link_token_event_repo.get_valid_token(ctx, input.user_id, input.is_update_mode, { max_age_hours: types_1.LINK_TOKEN_CACHE_TTL_HOURS });
    // 2. Fetch user profile
    const user = await user_repo_1.user_repo.get_by_id(ctx, input.user_id);
    const user_data = (_a = user === null || user === void 0 ? void 0 : user.data) !== null && _a !== void 0 ? _a : null;
    // 3. Existing active Plaid items for this user
    const active_items = await plaid_1.plaid_item_repo.get_by_user_id(ctx, input.user_id);
    // 4. Validate access token if provided (update mode): the user must have at
    //    least one active item.
    let access_token_valid = true;
    if (input.access_token) {
        access_token_valid = active_items.length > 0;
    }
    (0, observability_1.log_operation_success)(span, input.user_id);
    return {
        user_display_name: (user_data === null || user_data === void 0 ? void 0 : user_data.displayName) ||
            (user_data === null || user_data === void 0 ? void 0 : user_data.name) ||
            "Family Finance User",
        user_email: (user_data === null || user_data === void 0 ? void 0 : user_data.email) || null,
        existing_item_count: active_items.length,
        access_token_valid,
        cached_token: (cached === null || cached === void 0 ? void 0 : cached.link_token) || null,
        cached_expiration: (cached === null || cached === void 0 ? void 0 : cached.expiration) || null,
    };
}
//# sourceMappingURL=link_token.resolver.js.map