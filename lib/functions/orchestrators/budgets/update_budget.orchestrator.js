"use strict";
/**
 * Update Budget Orchestrator
 *
 * Synchronous path for updating a budget: idempotency → resolve → compute →
 * persist → enqueue cascade. Category transfer and period regeneration are
 * deferred to the process_budget_updated job.
 *
 * @module orchestrators/budgets/update_budget
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.update_budget_orchestrator = update_budget_orchestrator;
const firestore_1 = require("firebase-admin/firestore");
const errors_1 = require("../../types/errors");
const observability_1 = require("../../observability");
const idempotency_store_1 = require("../../infrastructure/idempotency_store");
const job_queue_1 = require("../../infrastructure/job_queue");
const budget_repo_1 = require("../../repositories/budget.repo");
const update_budget_service_1 = require("../../domain/budgets/update_budget.service");
const period_generation_service_1 = require("../../domain/budgets/period_generation.service");
const update_budget_resolver_1 = require("../../resolvers/budgets/update_budget.resolver");
/**
 * Updates a budget.
 */
async function update_budget_orchestrator(ctx, user_id, idempotency_key, input) {
    var _a;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "update_budget");
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
        // 1. Resolve (loads existing budget + category deltas)
        const dependencies = await (0, update_budget_resolver_1.resolve_update_budget_dependencies)(ctx, user_id, input);
        // 2. Domain computation (pure) — enforces guardrails, recomputes remaining
        const computed = (0, update_budget_service_1.compute_update_budget)({
            user_id,
            input,
            dependencies,
            now: firestore_1.Timestamp.now(),
        });
        if (computed.validation_errors || !computed.entity) {
            throw new errors_1.ValidationError((_a = computed.validation_errors) !== null && _a !== void 0 ? _a : ["update failed"]);
        }
        const entity = computed.entity;
        // 3. Persist the updated budget document
        await budget_repo_1.budget_repo.save(ctx, entity);
        // 4. Build claims for added categories from the resolved owner map.
        const added_claims = dependencies.added_category_ids.map((category_id) => ({
            category_id,
            from_budget_id: null,
        }));
        // 5. Enqueue cascade (claims/releases + period reallocation + rename)
        const name_changed = entity.name !== dependencies.existing.name;
        const needs_cascade = added_claims.length > 0 ||
            dependencies.removed_category_ids.length > 0 ||
            dependencies.amount_changed ||
            name_changed;
        if (needs_cascade) {
            const generation_end = (0, period_generation_service_1.compute_period_generation_end)(entity.start_date.toDate(), entity.is_ongoing, entity.budget_end_date ? entity.budget_end_date.toDate() : null);
            const payload = {
                budget_id: entity.id,
                user_id,
                group_ids: entity.group_ids,
                budget_name: entity.name,
                category_ids: entity.category_ids,
                amount: entity.amount,
                cadence: (0, period_generation_service_1.budget_cadence_to_instance)(entity.period),
                start_ms: entity.start_date.toMillis(),
                generation_end_ms: generation_end.getTime(),
                is_recurring: entity.is_ongoing,
                added_claims,
                released_category_ids: dependencies.removed_category_ids,
                everything_else_budget_id: dependencies.everything_else_budget_id,
                regenerate_periods: dependencies.amount_changed,
                name_changed,
            };
            await (0, job_queue_1.create_job)("process_budget_updated", payload, { trace_id: ctx.trace_id });
        }
        const response = {
            budget_id: entity.id,
            name: entity.name,
            amount: entity.amount,
            category_ids: entity.category_ids,
            period: entity.period,
            categories_claimed: added_claims.length,
            categories_released: dependencies.removed_category_ids.length,
            processing_background: needs_cascade,
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
//# sourceMappingURL=update_budget.orchestrator.js.map