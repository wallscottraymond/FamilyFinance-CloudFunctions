"use strict";
/**
 * Set Budget Pause Orchestrator (Code-Health-Review M1-M1, PZ1–PZ6)
 *
 * Pause / resume a budget for exactly the days of one period. Only the budget's `pausedRanges`
 * is written — never a split: read time moves a paused day's spending to Everything Else and
 * takes the paused days' share out of the budget (derive_period, derive_budget_transactions,
 * widgets, Home — one owner rule). Then:
 *   - bump the derive version (24h caches) AFTER the write
 *   - recompute the stored `spent` of the periods holding those days (it leaves paused days out,
 *     so the rollover chain carries exactly what the page shows — PZ6)
 *
 * Idempotent by construction (pause = union, resume = subtract); a concurrent change to the same
 * budget's ranges is retried, never overwritten.
 *
 * @module orchestrators/budgets/set_budget_pause
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.set_budget_pause_orchestrator = set_budget_pause_orchestrator;
const errors_1 = require("../../types/errors");
const observability_1 = require("../../observability");
const budget_repo_1 = require("../../repositories/budget.repo");
const derive_version_repo_1 = require("../../repositories/derive_version.repo");
const job_queue_1 = require("../../infrastructure/job_queue");
const set_budget_pause_resolver_1 = require("../../resolvers/budgets/set_budget_pause.resolver");
const budget_pause_service_1 = require("../../domain/budgets/budget_pause.service");
const MAX_ATTEMPTS = 3;
async function set_budget_pause_orchestrator(ctx, user_id, input) {
    var _a, _b;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "set_budget_pause");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            // 1. Resolve (the budget, access-checked)
            const { existing } = await (0, set_budget_pause_resolver_1.resolve_set_budget_pause_dependencies)(ctx, user_id, input.budget_id);
            if (existing.is_fund)
                throw new errors_1.ValidationError(["A fund can't be paused"]);
            const current = (_a = existing.paused_ranges) !== null && _a !== void 0 ? _a : [];
            // 2. Domain (pure)
            const computed = (0, budget_pause_service_1.compute_budget_pause)({
                current,
                start_day: input.start_day,
                end_day: input.end_day,
                paused: input.paused,
                is_everything_else: existing.is_system_everything_else === true,
            });
            if (computed.validation_errors || !computed.entity) {
                throw new errors_1.ValidationError((_b = computed.validation_errors) !== null && _b !== void 0 ? _b : ["pause failed"]);
            }
            const next = computed.entity;
            // 3. Persist (compare-and-set on the ranges)
            const written = await budget_repo_1.budget_repo.replace_paused_ranges_if_unchanged(ctx, existing.id, current, next, user_id);
            if (!written)
                continue; // changed meanwhile → re-read and re-apply
            // 4. Invalidate derive caches after the write (derive-cache 24h rule).
            await (0, derive_version_repo_1.bump_derive_version)(existing.user_id);
            // 5. The stored spent of those days' periods (and, through it, the rollover chain).
            const dates = (0, budget_pause_service_1.pause_recompute_dates)(input.start_day, input.end_day);
            if (dates.length > 0) {
                await (0, job_queue_1.create_job)("recompute_budget_spent", {
                    user_id: existing.user_id,
                    budget_ids: [existing.id],
                    dates_ms_by_budget: { [existing.id]: dates },
                    force_rollover: true, // the carry into later periods follows the pause now (PZ6)
                }, { trace_id: ctx.trace_id });
            }
            (0, observability_1.log_operation_success)(span, user_id);
            return {
                paused_ranges: next.map((r) => ({ start: (0, budget_pause_service_1.iso_from_day)(r.start_day), end: (0, budget_pause_service_1.iso_from_day)(r.end_day) })),
            };
        }
        throw new Error("The budget kept changing — try again");
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), {
            user_id,
            error_code: "SET_BUDGET_PAUSE_FAILED",
        });
        throw error;
    }
}
//# sourceMappingURL=set_budget_pause.orchestrator.js.map