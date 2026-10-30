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
const sharing_1 = require("../../repositories/sharing");
const group_service_1 = require("../../domain/sharing/group.service");
const budget_view_service_1 = require("../../domain/sharing/budget_view.service");
const group_everything_else_1 = require("../sharing/group_everything_else");
/**
 * Creates a budget.
 *
 * @param ctx - Trace context
 * @param user_id - User creating the budget
 * @param idempotency_key - Client idempotency key
 * @param input - Normalized create input
 */
async function create_budget_orchestrator(ctx, user_id, idempotency_key, input) {
    var _a, _b;
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
        // 2. Resolve the view (Account-Rooted-Sharing PD6): Me → the caller's uid;
        //    a group → "group:<id>" after checking the caller is a member.
        let owner_key = user_id;
        if (input.view_group_id) {
            const group = await sharing_1.group_repo.get(ctx, input.view_group_id);
            if (!(0, group_service_1.is_member)(group, user_id)) {
                throw new errors_1.ValidationError(["You're not in this group"]);
            }
            owner_key = (0, budget_view_service_1.group_view_key)(input.view_group_id);
            await (0, group_everything_else_1.ensure_group_everything_else)(ctx, input.view_group_id);
        }
        // 2b. Resolve dependencies (read-only) within that view
        const dependencies = await (0, create_budget_resolver_1.resolve_create_budget_dependencies)(ctx, owner_key, input);
        // 3. Domain computation (pure)
        const budget_id = budget_repo_1.budget_repo.new_id();
        const computed = (0, create_budget_service_1.compute_create_budget)({
            budget_id,
            user_id: owner_key,
            created_by: user_id,
            input,
            dependencies,
            now: firestore_1.Timestamp.now(),
        });
        if (computed.validation_errors || !computed.entity) {
            throw new errors_1.ValidationError((_a = computed.validation_errors) !== null && _a !== void 0 ? _a : ["create failed"]);
        }
        const entity = computed.entity;
        // 4. Plan the category claims in THIS view (pure; canon A3/A3b) — refused before anything is
        //    written when it would leave another budget with no categories.
        const plan = (0, category_ownership_service_1.plan_view_claims)({
            budget_id,
            added_category_ids: entity.category_ids,
            view_budgets: dependencies.view_budgets,
            first_of: (id) => { var _a; return (_a = dependencies.first_by_category[id]) !== null && _a !== void 0 ? _a : null; },
        });
        if (plan.validation_errors || !plan.entity) {
            throw new errors_1.ValidationError((_b = plan.validation_errors) !== null && _b !== void 0 ? _b : ["category claim failed"]);
        }
        const sources = new Set(plan.entity.claims.map((c) => c.from_budget_id).filter(Boolean));
        const rehome_from_ms = Math.min(entity.start_date.toMillis(), ...dependencies.view_budgets.filter((b) => sources.has(b.id)).map((b) => b.start_ms));
        // 5. Persist the budget document
        await budget_repo_1.budget_repo.save(ctx, entity);
        // 6. Enqueue the cascade job (category transfer + period generation).
        // Generation spans the full horizon (12mo ahead for ongoing budgets), NOT
        // the budget's nominal one-period end_date.
        const generation_end = (0, period_generation_service_1.compute_period_generation_end)(entity.start_date.toDate(), entity.is_ongoing, entity.budget_end_date ? entity.budget_end_date.toDate() : null);
        const payload = {
            budget_id,
            user_id: owner_key,
            group_ids: entity.group_ids,
            budget_name: entity.name,
            category_ids: entity.category_ids,
            amount: entity.amount,
            cadence: (0, period_generation_service_1.budget_cadence_to_instance)(entity.period),
            start_ms: entity.start_date.toMillis(),
            generation_end_ms: generation_end.getTime(),
            is_recurring: entity.is_ongoing,
            claims: plan.entity.claims,
            everything_else_budget_id: dependencies.everything_else_budget_id,
            rehome_from_ms,
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