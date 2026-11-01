"use strict";
/**
 * set_budget_pause resolver (read-only): the budget being paused, if the caller may manage it.
 * Group budgets (owner key "group:<id>") are managed by any member, like every budget edit.
 *
 * @module resolvers/budgets/set_budget_pause
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_set_budget_pause_dependencies = resolve_set_budget_pause_dependencies;
const errors_1 = require("../../types/errors");
const observability_1 = require("../../observability");
const budget_repo_1 = require("../../repositories/budget.repo");
const sharing_1 = require("../../repositories/sharing");
const budget_view_service_1 = require("../../domain/sharing/budget_view.service");
async function resolve_set_budget_pause_dependencies(ctx, user_id, budget_id) {
    const span = (0, observability_1.create_span)(ctx, "resolver", "resolve_set_budget_pause_dependencies");
    (0, observability_1.log_operation_start)(span, user_id);
    const existing = await budget_repo_1.budget_repo.get_by_id(ctx, budget_id);
    const owner_group_id = existing ? (0, budget_view_service_1.group_id_of_key)(existing.user_id) : null;
    const owner_group = owner_group_id ? await sharing_1.group_repo.get(ctx, owner_group_id) : null;
    // A budget the caller can't manage is "not found" (don't reveal it exists).
    if (!existing || !existing.is_active || !(0, budget_view_service_1.can_manage_budget)(existing.user_id, user_id, owner_group)) {
        throw new errors_1.NotFoundError("budget", budget_id);
    }
    (0, observability_1.log_operation_success)(span, user_id);
    return { existing };
}
//# sourceMappingURL=set_budget_pause.resolver.js.map