"use strict";
/**
 * Derive Goals View Orchestrator — Goals (Phase 1)
 *
 * Read-only. Resolves a viewed period's bounds, measures every active goal for
 * that period (balance snapshots + priority partition), and returns a camelCase
 * DTO for the period-page Goals section. Writes nothing.
 *
 * @module orchestrators/goals/derive_goals_view
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.derive_goals_view_orchestrator = derive_goals_view_orchestrator;
const errors_1 = require("../../types/errors");
const observability_1 = require("../../observability");
const source_period_repo_1 = require("../../repositories/source_period.repo");
const goal_measurement_resolver_1 = require("../../resolvers/goals/goal_measurement.resolver");
async function derive_goals_view_orchestrator(ctx, user_id, period_id) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "derive_goals_view");
    (0, observability_1.log_operation_start)(span, user_id);
    const period = await source_period_repo_1.source_period_repo.get_by_id(ctx, period_id);
    if (!period) {
        throw new errors_1.NotFoundError("source_period", period_id);
    }
    const views = await (0, goal_measurement_resolver_1.resolve_goal_measurements)(ctx, user_id, period_id, period.start_date, period.end_date);
    const goals = views.map(({ goal, measurement }) => {
        var _a;
        return ({
            goalId: goal.id,
            goalType: goal.goal_type,
            name: goal.name,
            status: goal.status,
            linkedAccountId: goal.linked_account_id,
            targetAmount: (_a = goal.target_amount) !== null && _a !== void 0 ? _a : null,
            homeCadence: goal.home_cadence,
            perPeriodAmount: goal.per_period_amount,
            priorityRank: goal.priority_rank,
            drawsIncome: goal.draws_income,
            baselineBalance: goal.baseline_balance,
            targetForPeriod: measurement.target_for_period,
            progressForPeriod: measurement.progress_for_period,
            cumulativeProgress: measurement.cumulative_progress,
            met: measurement.met,
            targetReached: measurement.target_reached,
            dataIncomplete: measurement.data_incomplete,
        });
    });
    const totalDrawThisPeriod = goals
        .filter((g) => g.drawsIncome && g.status === "active")
        .reduce((sum, g) => sum + g.targetForPeriod, 0);
    (0, observability_1.log_operation_success)(span, user_id);
    return { periodId: period_id, goals, totalDrawThisPeriod };
}
//# sourceMappingURL=derive_goals_view.orchestrator.js.map