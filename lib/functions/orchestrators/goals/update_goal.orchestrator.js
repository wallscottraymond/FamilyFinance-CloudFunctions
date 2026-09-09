"use strict";
/**
 * Update Goal Orchestrator — Goals (Phase 1)
 *
 * idempotency → load + ownership check → compute merge (pure) → persist.
 *
 * @module orchestrators/goals/update_goal
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.update_goal_orchestrator = update_goal_orchestrator;
const firestore_1 = require("firebase-admin/firestore");
const errors_1 = require("../../types/errors");
const observability_1 = require("../../observability");
const idempotency_store_1 = require("../../infrastructure/idempotency_store");
const goal_repo_1 = require("../../repositories/goal.repo");
const goal_service_1 = require("../../domain/goals/goal.service");
async function update_goal_orchestrator(ctx, user_id, idempotency_key, input) {
    var _a;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "update_goal");
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
        const existing = await goal_repo_1.goal_repo.get_by_id(ctx, input.goal_id);
        if (!existing) {
            throw new errors_1.NotFoundError("goal", input.goal_id);
        }
        if (existing.owner_id !== user_id) {
            throw new errors_1.PermissionDeniedError("update_goal", input.goal_id);
        }
        const computed = (0, goal_service_1.compute_update_goal)({
            existing,
            input,
            now: firestore_1.Timestamp.now(),
        });
        if (computed.validation_errors || !computed.entity) {
            throw new errors_1.ValidationError((_a = computed.validation_errors) !== null && _a !== void 0 ? _a : ["update failed"]);
        }
        await goal_repo_1.goal_repo.save(ctx, computed.entity);
        const response = { goal_id: input.goal_id, updated: true };
        await (0, idempotency_store_1.complete_key)(ctx, idempotency_key, response);
        (0, observability_1.log_operation_success)(span, user_id);
        return response;
    }
    catch (error) {
        await (0, idempotency_store_1.fail_key)(ctx, idempotency_key, error instanceof Error ? error.message : "Unknown error");
        throw error;
    }
}
//# sourceMappingURL=update_goal.orchestrator.js.map