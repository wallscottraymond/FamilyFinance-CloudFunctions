"use strict";
/**
 * Create Goal Resolver — Goals (Phase 1)
 *
 * Read-only dependency analysis for creating a goal:
 *  - the linked account (baseline balance, ownership check, invest-type check)
 *  - the user's existing goals on that account (next priority rank + count)
 *
 * @module resolvers/goals/create_goal
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_create_goal_dependencies = resolve_create_goal_dependencies;
const errors_1 = require("../../types/errors");
const account_repo_1 = require("../../repositories/account.repo");
const goal_repo_1 = require("../../repositories/goal.repo");
async function resolve_create_goal_dependencies(ctx, user_id, input) {
    var _a;
    // 1. The linked account must exist and be owned by the caller.
    const account = await account_repo_1.account_repo.get_by_id(ctx, input.linked_account_id);
    if (!account) {
        throw new errors_1.NotFoundError("account", input.linked_account_id);
    }
    if (account.access.owner_id !== user_id) {
        throw new errors_1.PermissionDeniedError("create_goal", input.linked_account_id);
    }
    // 2. Invest goals must target an investment account.
    if (input.goal_type === "invest" && account.account_type !== "investment") {
        throw new errors_1.ValidationError([
            "An Invest goal must be linked to an investment account",
        ]);
    }
    // 3. Existing goals on this account → priority rank (fill order) + count.
    const existing = await goal_repo_1.goal_repo.get_by_account(ctx, user_id, input.linked_account_id);
    const max_rank = existing.reduce((m, g) => Math.max(m, g.priority_rank), -1);
    return {
        baseline_balance: (_a = account.balances.current) !== null && _a !== void 0 ? _a : 0,
        priority_rank: max_rank + 1,
        existing_goals_on_account: existing.length,
    };
}
//# sourceMappingURL=create_goal.resolver.js.map