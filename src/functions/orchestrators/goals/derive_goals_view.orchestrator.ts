/**
 * Derive Goals View Orchestrator — Goals (Phase 1)
 *
 * Read-only. Resolves a viewed period's bounds, measures every active goal for
 * that period (balance snapshots + priority partition), and returns a camelCase
 * DTO for the period-page Goals section. Writes nothing.
 *
 * @module orchestrators/goals/derive_goals_view
 */

import { TraceContext } from "../../types";
import { NotFoundError } from "../../types/errors";
import {
  create_span,
  log_operation_start,
  log_operation_success,
} from "../../observability";
import { source_period_repo } from "../../repositories/source_period.repo";
import { resolve_goal_measurements } from "../../resolvers/goals/goal_measurement.resolver";

/** One goal + its measurement for the viewed period (camelCase FE DTO). */
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

export async function derive_goals_view_orchestrator(
  ctx: TraceContext,
  user_id: string,
  period_id: string
): Promise<DeriveGoalsViewResult> {
  const span = create_span(ctx, "orchestrator", "derive_goals_view");
  log_operation_start(span, user_id);

  const period = await source_period_repo.get_by_id(ctx, period_id);
  if (!period) {
    throw new NotFoundError("source_period", period_id);
  }

  const views = await resolve_goal_measurements(
    ctx,
    user_id,
    period_id,
    period.start_date,
    period.end_date
  );

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

  log_operation_success(span, user_id);
  return { periodId: period_id, goals, totalDrawThisPeriod };
}
