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
import {
  resolve_goal_measurements,
  resolve_own_goal_measurements,
} from "../../resolvers/goals/goal_measurement.resolver";
import { DeriveScopeRequest } from "../../domain/periods/derive_scope.service";

/** One goal + its measurement for the viewed period (camelCase FE DTO). */
export type { GoalViewItem, DeriveGoalsViewResult } from "../../domain/goals/goals_view.service";
import {
  build_goals_view,
  DeriveGoalsViewResult,
} from "../../domain/goals/goals_view.service";

export async function derive_goals_view_orchestrator(
  ctx: TraceContext,
  user_id: string,
  period_id: string,
  scope?: DeriveScopeRequest,
  own_goals = false
): Promise<DeriveGoalsViewResult> {
  const span = create_span(ctx, "orchestrator", "derive_goals_view");
  log_operation_start(span, user_id);

  const period = await source_period_repo.get_by_id(ctx, period_id);
  if (!period) {
    throw new NotFoundError("source_period", period_id);
  }

  const views = own_goals
    ? await resolve_own_goal_measurements(ctx, user_id, period_id, period.start_date, period.end_date)
    : await resolve_goal_measurements(
        ctx,
        user_id,
        period_id,
        period.start_date,
        period.end_date,
        scope
      );

  const result = build_goals_view(period_id, views, scope?.kind === "group");

  log_operation_success(span, user_id);
  return result;
}
