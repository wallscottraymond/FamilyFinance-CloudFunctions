/**
 * Goals View Service (pure)
 *
 * Shapes measured goals into the client's per-period goals view. Shared by `derive_goals_view`
 * (one period) and `derive_period_range` (many periods) so both return identical goal items.
 *
 * @module domain/goals/goals_view.service
 */

import { GoalEntity, GoalMeasurement } from "../../types/goals/goal_entity.types";

// The goals view is the CLIENT wire format (camelCase, consumed as-is by the mobile app).
/* eslint-disable @typescript-eslint/naming-convention */

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
  // measurement (viewed period)
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

export function build_goals_view(
  period_id: string,
  views: Array<{ goal: GoalEntity; measurement: GoalMeasurement }>
): DeriveGoalsViewResult {
  const goals: GoalViewItem[] = views.map(({ goal, measurement }) => ({
    goalId: goal.id,
    goalType: goal.goal_type,
    name: goal.name,
    status: goal.status,
    linkedAccountId: goal.linked_account_id,
    targetAmount: goal.target_amount ?? null,
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
  }));

  const totalDrawThisPeriod = goals
    .filter((g) => g.drawsIncome && g.status === "active")
    .reduce((sum, g) => sum + g.targetForPeriod, 0);
  return { periodId: period_id, goals, totalDrawThisPeriod };
}
