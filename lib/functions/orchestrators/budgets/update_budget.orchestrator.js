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
const derive_version_repo_1 = require("../../repositories/derive_version.repo");
const budget_pause_service_1 = require("../../domain/budgets/budget_pause.service");
/** Stored-spent days recomputed after an auto-resume (≤ one period, as for a return). */
const RESUME_RECOMPUTE_DAYS = 31;
/** Compare-and-set retries for the auto-resume's pause write. */
const MAX_RESUME_ATTEMPTS = 3;
const budget_repo_1 = require("../../repositories/budget.repo");
const update_budget_service_1 = require("../../domain/budgets/update_budget.service");
const period_generation_service_1 = require("../../domain/budgets/period_generation.service");
const update_budget_resolver_1 = require("../../resolvers/budgets/update_budget.resolver");
/** Clears the paused days from today on, compare-and-set; a concurrent change is re-read. */
async function apply_auto_resume(ctx, existing, entity, user_id) {
    var _a, _b, _c, _d;
    let expected = (_a = existing.paused_ranges) !== null && _a !== void 0 ? _a : [];
    let next = (_b = entity.paused_ranges) !== null && _b !== void 0 ? _b : [];
    for (let attempt = 0; attempt < MAX_RESUME_ATTEMPTS; attempt++) {
        const written = await budget_repo_1.budget_repo.replace_paused_ranges_if_unchanged(ctx, entity.id, expected, next, user_id);
        if (written)
            return;
        expected = (_d = (_c = (await budget_repo_1.budget_repo.get_by_id(ctx, entity.id))) === null || _c === void 0 ? void 0 : _c.paused_ranges) !== null && _d !== void 0 ? _d : [];
        const again = (0, budget_pause_service_1.resume_on_recategorize)({
            before_category_ids: [],
            after_category_ids: entity.category_ids,
            paused_ranges: expected,
            now_ms: entity.updated_at.toMillis(),
        });
        if (!again)
            return; // nothing is paused from today on any more
        next = again;
    }
    throw new Error("The budget kept changing — try again");
}
/** Derive bump (after the write) + stored spent, so rollover follows. Never throws. */
async function auto_resume_follow_ups(ctx, entity) {
    try {
        await (0, derive_version_repo_1.bump_derive_version)(entity.user_id);
    }
    catch (error) {
        console.error(`[${ctx.trace_id}] auto-resume bump failed (non-fatal):`, error);
    }
    try {
        const today = (0, budget_pause_service_1.utc_day)(Date.now());
        await (0, job_queue_1.create_job)("recompute_budget_spent", {
            user_id: entity.user_id,
            budget_ids: [entity.id],
            dates_ms_by_budget: {
                [entity.id]: (0, budget_pause_service_1.pause_recompute_dates)((0, budget_pause_service_1.iso_from_day)(today), (0, budget_pause_service_1.iso_from_day)(today + RESUME_RECOMPUTE_DAYS)),
            },
            force_rollover: true,
        }, { trace_id: ctx.trace_id });
    }
    catch (error) {
        console.error(`[${ctx.trace_id}] auto-resume recompute enqueue failed (non-fatal):`, error);
    }
}
/**
 * Updates a budget.
 */
async function update_budget_orchestrator(ctx, user_id, idempotency_key, input) {
    var _a, _b, _c, _d;
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
        // Auto-resume (S1-M4 follow-up): the domain cleared the paused days from today on. Written
        // compare-and-set (a pause / resume racing this edit is kept — PZ5) and BEFORE the
        // categories, so a retry after a failure in between still sees the empty → non-empty transition.
        const existing = dependencies.existing;
        const resumes = JSON.stringify((_c = entity.paused_ranges) !== null && _c !== void 0 ? _c : []) !== JSON.stringify((_d = existing.paused_ranges) !== null && _d !== void 0 ? _d : []);
        if (resumes)
            await apply_auto_resume(ctx, existing, entity, user_id);
        // Only the fields this edit changed: a concurrent change to the budget isn't overwritten
        // (M3-M4). The pause isn't one of them here: it was written above.
        await budget_repo_1.budget_repo.save_changes(ctx, existing, Object.assign(Object.assign({}, entity), { paused_ranges: existing.paused_ranges }));
        // 4b. The budget write landed, so these can't fail the request: a retry would find the
        //     categories already saved and skip the claims / re-home below (verify L4). The on-write
        //     trigger bumps too, and the next change / nightly job catches the recompute up.
        if (resumes)
            await auto_resume_follow_ups(ctx, entity);
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
            const payload = Object.assign(Object.assign({ budget_id: entity.id }, (entity.is_fund ? { fund_total: entity.amount } : {})), { user_id: entity.user_id, group_ids: entity.group_ids, budget_name: entity.name, category_ids: entity.category_ids, amount: (0, period_generation_service_1.budget_amount_per_instance)(entity.amount, entity.period), cadence: (0, period_generation_service_1.budget_cadence_to_instance)(entity.period), start_ms: entity.start_date.toMillis(), generation_end_ms: generation_end.getTime(), is_recurring: entity.is_ongoing, added_claims, released_category_ids: dependencies.removed_category_ids, everything_else_budget_id: dependencies.everything_else_budget_id, rehome_from_ms,
                range_changed, regenerate_periods: dependencies.amount_changed, name_changed });
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