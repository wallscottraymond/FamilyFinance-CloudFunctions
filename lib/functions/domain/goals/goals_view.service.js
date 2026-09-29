"use strict";
/**
 * Goals View Service (pure)
 *
 * Shapes measured goals into the client's per-period goals view. Shared by `derive_goals_view`
 * (one period) and `derive_period_range` (many periods) so both return identical goal items.
 *
 * @module domain/goals/goals_view.service
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.build_goals_view = build_goals_view;
function build_goals_view(period_id, views) {
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
    return { periodId: period_id, goals, totalDrawThisPeriod };
}
//# sourceMappingURL=goals_view.service.js.map