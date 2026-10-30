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
const category_ownership_service_1 = require("../../domain/budgets/category_ownership.service");
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
    var _a, _b;
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
        // 3. Plan the claims for added categories in THIS budget's view (canon A3/A3b): taken from
        //    the budget that owns them there — refused before any write if that would leave it empty.
        const plan = (0, category_ownership_service_1.plan_view_claims)({
            budget_id: entity.id,
            added_category_ids: dependencies.added_category_ids,
            view_budgets: dependencies.view_budgets,
            first_of: (id) => { var _a; return (_a = dependencies.first_by_category[id]) !== null && _a !== void 0 ? _a : null; },
        });
        if (plan.validation_errors || !plan.entity) {
            throw new errors_1.ValidationError((_b = plan.validation_errors) !== null && _b !== void 0 ? _b : ["category claim failed"]);
        }
        const added_claims = plan.entity.claims;
        const sources = new Set(added_claims.map((c) => c.from_budget_id).filter(Boolean));
        const rehome_from_ms = Math.min(entity.start_date.toMillis(), ...dependencies.view_budgets.filter((b) => sources.has(b.id)).map((b) => b.start_ms));
        // 4. Persist the updated budget document
        // Only the fields this edit changed: a concurrent change to the budget isn't overwritten (M3-M4).
        await budget_repo_1.budget_repo.save_changes(ctx, dependencies.existing, entity);
        // 5. Enqueue cascade (claims/releases + period reallocation + rename)
        const name_changed = entity.name !== dependencies.existing.name;
        // An end-date / ongoing change moves which dates the budget owns → its transactions re-home.
        const end_ms = (b) => { var _a, _b; return b.is_ongoing ? null : (_b = (_a = b.budget_end_date) === null || _a === void 0 ? void 0 : _a.toMillis()) !== null && _b !== void 0 ? _b : null; };
        const range_changed = end_ms(entity) !== end_ms(dependencies.existing);
        const needs_cascade = range_changed ||
            added_claims.length > 0 ||
            dependencies.removed_category_ids.length > 0 ||
            dependencies.amount_changed ||
            name_changed;
        if (needs_cascade) {
            const generation_end = (0, period_generation_service_1.compute_period_generation_end)(entity.start_date.toDate(), entity.is_ongoing, entity.budget_end_date ? entity.budget_end_date.toDate() : null);
            const payload = {
                budget_id: entity.id,
                user_id: entity.user_id, // owner key (PD6): the cascade works in the budget's view
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
                rehome_from_ms,
                range_changed,
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