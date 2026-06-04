"use strict";
/**
 * Create Budget Orchestrator
 *
 * Synchronous path for creating a budget: idempotency → resolve → compute →
 * persist → enqueue cascade. Heavy work (category transfer, period generation)
 * is deferred to the process_budget_created job.
 *
 * @module orchestrators/budgets/create_budget
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.create_budget_orchestrator = create_budget_orchestrator;
const firestore_1 = require("firebase-admin/firestore");
const errors_1 = require("../../types/errors");
const observability_1 = require("../../observability");
const idempotency_store_1 = require("../../infrastructure/idempotency_store");
const job_queue_1 = require("../../infrastructure/job_queue");
const budget_repo_1 = require("../../repositories/budget.repo");
const create_budget_service_1 = require("../../domain/budgets/create_budget.service");
const category_ownership_service_1 = require("../../domain/budgets/category_ownership.service");
const period_generation_service_1 = require("../../domain/budgets/period_generation.service");
const create_budget_resolver_1 = require("../../resolvers/budgets/create_budget.resolver");
/**
 * Creates a budget.
 *
 * @param ctx - Trace context
 * @param user_id - User creating the budget
 * @param idempotency_key - Client idempotency key
 * @param input - Normalized create input
 */
async function create_budget_orchestrator(ctx, user_id, idempotency_key, input) {
    var _a, _b, _c;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "create_budget");
    (0, observability_1.log_operation_start)(span, user_id);
    // 1. Idempotency check
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
        // 2. Resolve dependencies (read-only)
        const dependencies = await (0, create_budget_resolver_1.resolve_create_budget_dependencies)(ctx, user_id, input);
        // 3. Domain computation (pure)
        const budget_id = budget_repo_1.budget_repo.new_id();
        const computed = (0, create_budget_service_1.compute_create_budget)({
            budget_id,
            user_id,
            input,
            dependencies,
            now: firestore_1.Timestamp.now(),
        });
        if (computed.validation_errors || !computed.entity) {
            throw new errors_1.ValidationError((_a = computed.validation_errors) !== null && _a !== void 0 ? _a : ["create failed"]);
        }
        const entity = computed.entity;
        // 4. Persist the budget document
        await budget_repo_1.budget_repo.save(ctx, entity);
        // 5. Compute the category transfer plan (pure)
        const plan = (0, category_ownership_service_1.compute_create_transfer_plan)(entity.category_ids, dependencies.category_owners, budget_id);
        // 6. Enqueue the cascade job (category transfer + period generation).
        // Generation spans the full horizon (12mo ahead for ongoing budgets), NOT
        // the budget's nominal one-period end_date.
        const generation_end = (0, period_generation_service_1.compute_period_generation_end)(entity.start_date.toDate(), entity.is_ongoing, entity.budget_end_date ? entity.budget_end_date.toDate() : null);
        const payload = {
            budget_id,
            user_id,
            group_ids: entity.group_ids,
            budget_name: entity.name,
            category_ids: entity.category_ids,
            amount: entity.amount,
            cadence: (0, period_generation_service_1.budget_cadence_to_instance)(entity.period),
            start_ms: entity.start_date.toMillis(),
            generation_end_ms: generation_end.getTime(),
            is_recurring: entity.is_ongoing,
            claims: (_c = (_b = plan.entity) === null || _b === void 0 ? void 0 : _b.claims.map((c) => ({
                category_id: c.category_id,
                from_budget_id: c.from_budget_id,
            }))) !== null && _c !== void 0 ? _c : [],
            everything_else_budget_id: dependencies.everything_else_budget_id,
        };
        await (0, job_queue_1.create_job)("process_budget_created", payload, { trace_id: ctx.trace_id });
        // 7. Build response and complete idempotency key
        const response = {
            budget_id,
            name: entity.name,
            amount: entity.amount,
            currency: entity.currency,
            category_ids: entity.category_ids,
            period: entity.period,
            is_shared: !entity.is_private,
            categories_claimed: payload.claims.length,
            processing_background: true,
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
//# sourceMappingURL=create_budget.orchestrator.js.map