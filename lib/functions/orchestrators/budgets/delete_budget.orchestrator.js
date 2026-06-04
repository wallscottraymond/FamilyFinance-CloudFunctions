"use strict";
/**
 * Delete Budget Orchestrator
 *
 * Synchronous path for deleting a budget: idempotency → resolve → validate →
 * delete document → enqueue cascade. The cascade (period deletion, transaction
 * reassignment, category release) runs in process_budget_deleted.
 *
 * @module orchestrators/budgets/delete_budget
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.delete_budget_orchestrator = delete_budget_orchestrator;
const firestore_1 = require("firebase-admin/firestore");
const errors_1 = require("../../types/errors");
const observability_1 = require("../../observability");
const idempotency_store_1 = require("../../infrastructure/idempotency_store");
const job_queue_1 = require("../../infrastructure/job_queue");
const budget_repo_1 = require("../../repositories/budget.repo");
const delete_budget_service_1 = require("../../domain/budgets/delete_budget.service");
const delete_budget_resolver_1 = require("../../resolvers/budgets/delete_budget.resolver");
/**
 * Deletes a budget.
 */
async function delete_budget_orchestrator(ctx, user_id, idempotency_key, budget_id) {
    var _a;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "delete_budget");
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
        // 1. Resolve dependencies (existing budget, periods, transactions, EE)
        const dependencies = await (0, delete_budget_resolver_1.resolve_delete_budget_dependencies)(ctx, user_id, budget_id);
        // 2. Domain validation + plan (pure) — blocks deleting Everything Else
        const computed = (0, delete_budget_service_1.compute_delete_budget)({
            user_id,
            dependencies,
            now: firestore_1.Timestamp.now(),
        });
        if (computed.validation_errors || !computed.entity) {
            throw new errors_1.ValidationError((_a = computed.validation_errors) !== null && _a !== void 0 ? _a : ["delete failed"]);
        }
        const plan = computed.entity;
        // 3. Delete the budget document (cascade cleans up the rest)
        await budget_repo_1.budget_repo.hard_delete(ctx, budget_id, user_id);
        // 4. Enqueue the cascade job
        if (plan.requires_cascade) {
            const payload = {
                budget_id,
                user_id,
                group_ids: dependencies.existing.group_ids,
                budget_period_ids: dependencies.budget_period_ids,
                affected_transaction_ids: dependencies.affected_transaction_ids,
                release_category_ids: plan.release_category_ids,
                everything_else_budget_id: dependencies.everything_else_budget_id,
            };
            await (0, job_queue_1.create_job)("process_budget_deleted", payload, { trace_id: ctx.trace_id });
        }
        const response = {
            budget_id,
            processing_background: plan.requires_cascade,
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
//# sourceMappingURL=delete_budget.orchestrator.js.map