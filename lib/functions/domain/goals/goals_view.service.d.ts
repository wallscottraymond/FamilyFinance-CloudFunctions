/**
 * Goals View Service (pure)
 *
 * Shapes measured goals into the client's per-period goals view. Shared by `derive_goals_view`
 * (one period) and `derive_period_range` (many periods) so both return identical goal items.
 *
 * @module domain/goals/goals_view.service
 */
import { GoalEntity, GoalMeasurement } from "../../types/goals/goal_entity.types";
export interface GoalViewItem {
    goalId: string;
    goalType: string;
    name: string;
    status: string;
    linkedAccountId: string;
    targetAmount: number | null;
    homeCadence: string;
    perPeriodAmount: number;
    priorityRank: number;
    drawsIncome: boolean;
    baselineBalance: number;
    targetForPeriod: number;
    progressForPeriod: number;
    cumulativeProgress: number;
    met: boolean;
    targetReached: boolean;
    dataIncomplete: boolean;
}
export interface DeriveGoalsViewResult {
    periodId: string;
    goals: GoalViewItem[];
    /** Total set-aside this period across goals that draw against income. */
    totalDrawThisPeriod: number;
}
export declare function build_goals_view(period_id: string, views: Array<{
    goal: GoalEntity;
    measurement: GoalMeasurement;
}>): DeriveGoalsViewResult;
//# sourceMappingURL=goals_view.service.d.ts.map