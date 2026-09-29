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
/** One goal + its measurement for the viewed period (camelCase FE DTO). */
export type { GoalViewItem, DeriveGoalsViewResult } from "../../domain/goals/goals_view.service";
import { DeriveGoalsViewResult } from "../../domain/goals/goals_view.service";
export declare function derive_goals_view_orchestrator(ctx: TraceContext, user_id: string, period_id: string): Promise<DeriveGoalsViewResult>;
//# sourceMappingURL=derive_goals_view.orchestrator.d.ts.map