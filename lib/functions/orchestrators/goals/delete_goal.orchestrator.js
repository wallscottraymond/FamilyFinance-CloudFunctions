"use strict";
/**
 * Delete Goal Orchestrator — Goals (Phase 1)
 *
 * idempotency → load + ownership check → soft-delete (deactivate + archive).
 * Soft delete keeps history and is recoverable; goals observe balances, so
 * there is no spend/period cascade to unwind.
 *
 * @module orchestrators/goals/delete_goal
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.delete_goal_orchestrator = delete_goal_orchestrator;
const errors_1 = require("../../types/errors");
const observability_1 = require("../../observability");
const idempotency_store_1 = require("../../infrastructure/idempotency_store");
const goal_repo_1 = require("../../repositories/goal.repo");
async function delete_goal_orchestrator(ctx, user_id, idempotency_key, goal_id) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "delete_goal");
    (0, observability_1.log_operation_start)(span, user_id);
    const check = await (0, idempotency_store_1.check_idempotency)(ctx, idempotency_key);
    if (check.is_duplicate) {
        if (check.status === "completed") {
            (0, observability_1.log_idempotent_return)(span, user_id);
            return check.cached_result;
        }
        if (check.status === "in_progress") {
            throw new Error("Request already in progress");
        }
    }
    const claimed = await (0, idempotency_store_1.claim_key)(ctx, idempotency_key);
    if (!claimed) {
        throw new Error("Request already in progress");
    }
    try {
        const existing = await goal_repo_1.goal_repo.get_by_id(ctx, goal_id);
        if (!existing) {
            throw new errors_1.NotFoundError("goal", goal_id);
        }
        if (existing.owner_id !== user_id) {
            throw new errors_1.PermissionDeniedError("delete_goal", goal_id);
        }
        await goal_repo_1.goal_repo.soft_delete(ctx, goal_id);
        const response = { goal_id, deleted: true };
        await (0, idempotency_store_1.complete_key)(ctx, idempotency_key, response);
        (0, observability_1.log_operation_success)(span, user_id);
        return response;
    }
    catch (error) {
        await (0, idempotency_store_1.fail_key)(ctx, idempotency_key, error instanceof Error ? error.message : "Unknown error");
        throw error;
    }
}
//# sourceMappingURL=delete_goal.orchestrator.js.map