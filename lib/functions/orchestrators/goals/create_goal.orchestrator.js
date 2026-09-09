"use strict";
/**
 * Create Goal Orchestrator — Goals (Phase 1)
 *
 * idempotency → resolve (account baseline + priority rank) → compute (pure) →
 * persist. Observe-only: no money movement, no cascade job (measurement is
 * derive-on-read from balance snapshots).
 *
 * @module orchestrators/goals/create_goal
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.create_goal_orchestrator = create_goal_orchestrator;
const firestore_1 = require("firebase-admin/firestore");
const errors_1 = require("../../types/errors");
const observability_1 = require("../../observability");
const idempotency_store_1 = require("../../infrastructure/idempotency_store");
const goal_repo_1 = require("../../repositories/goal.repo");
const create_goal_resolver_1 = require("../../resolvers/goals/create_goal.resolver");
const goal_service_1 = require("../../domain/goals/goal.service");
async function create_goal_orchestrator(ctx, user_id, idempotency_key, input) {
    var _a, _b;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "create_goal");
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
        // 1. Resolve dependencies (read-only)
        const deps = await (0, create_goal_resolver_1.resolve_create_goal_dependencies)(ctx, user_id, input);
        // 2. Domain computation (pure)
        const goal_id = goal_repo_1.goal_repo.new_id();
        const computed = (0, goal_service_1.compute_create_goal)({
            goal_id,
            user_id,
            input,
            baseline_balance: deps.baseline_balance,
            priority_rank: deps.priority_rank,
            now: firestore_1.Timestamp.now(),
        });
        if (computed.validation_errors || !computed.entity) {
            throw new errors_1.ValidationError((_a = computed.validation_errors) !== null && _a !== void 0 ? _a : ["create failed"]);
        }
        const entity = computed.entity;
        // 3. Persist
        await goal_repo_1.goal_repo.save(ctx, entity);
        // 4. Response
        const response = {
            goal_id,
            goal_type: entity.goal_type,
            name: entity.name,
            linked_account_id: entity.linked_account_id,
            target_amount: (_b = entity.target_amount) !== null && _b !== void 0 ? _b : null,
            per_period_amount: entity.per_period_amount,
            home_cadence: entity.home_cadence,
            priority_rank: entity.priority_rank,
            baseline_balance: entity.baseline_balance,
        };
        await (0, idempotency_store_1.complete_key)(ctx, idempotency_key, response);
        (0, observability_1.log_operation_success)(span, user_id);
        return response;
    }
    catch (error) {
        await (0, idempotency_store_1.fail_key)(ctx, idempotency_key, error instanceof Error ? error.message : "Unknown error");
        throw error;
    }
}
//# sourceMappingURL=create_goal.orchestrator.js.map