"use strict";
/**
 * Link Plaid Account Resolver
 *
 * Gathers dependencies needed for linking a Plaid account.
 * READ-ONLY operations - no mutations.
 *
 * @module resolvers/plaid/link_plaid_account
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_link_account_dependencies = resolve_link_account_dependencies;
const observability_1 = require("../../observability");
const plaid_1 = require("../../repositories/plaid");
const user_repo_1 = require("../../repositories/user.repo");
/**
 * Resolves dependencies for linking a Plaid account.
 *
 * Gathers:
 * - User's group IDs for RBAC
 * - Whether the institution is already linked (duplicate detection)
 *
 * @param ctx - Trace context
 * @param input - Resolution input
 * @returns Resolved dependencies
 */
async function resolve_link_account_dependencies(ctx, input) {
    var _a;
    const span = (0, observability_1.create_span)(ctx, "resolver", "resolve_link_account_dependencies");
    (0, observability_1.log_operation_start)(span, input.user_id);
    // 1. Fetch user profile for group IDs
    const user = await user_repo_1.user_repo.get_by_id(ctx, input.user_id);
    const user_data = (_a = user === null || user === void 0 ? void 0 : user.data) !== null && _a !== void 0 ? _a : null;
    // Extract group IDs from user profile
    const group_id = (user_data === null || user_data === void 0 ? void 0 : user_data.familyId) ||
        (user_data === null || user_data === void 0 ? void 0 : user_data.groupId) ||
        null;
    const group_ids = group_id ? [group_id] : [];
    // 2. Check if institution is already linked (via repository)
    const existing_item = await plaid_1.plaid_item_repo.get_by_user_and_institution(ctx, input.user_id, input.institution_id);
    const institution_already_linked = existing_item !== null;
    const existing_item_id = (existing_item === null || existing_item === void 0 ? void 0 : existing_item.id) || null;
    (0, observability_1.log_operation_success)(span, input.user_id);
    return {
        group_ids,
        institution_already_linked,
        existing_item_id,
    };
}
//# sourceMappingURL=link_plaid_account.resolver.js.map