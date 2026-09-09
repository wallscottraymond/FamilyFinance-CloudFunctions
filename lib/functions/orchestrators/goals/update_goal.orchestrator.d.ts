/**
 * Update Goal Orchestrator — Goals (Phase 1)
 *
 * idempotency → load + ownership check → compute merge (pure) → persist.
 *
 * @module orchestrators/goals/update_goal
 */
import { TraceContext } from "../../types";
import { UpdateGoalInput, UpdateGoalResponse } from "../../types/goals/goal_crud.types";
export declare function update_goal_orchestrator(ctx: TraceContext, user_id: string, idempotency_key: string, input: UpdateGoalInput): Promise<UpdateGoalResponse>;
//# sourceMappingURL=update_goal.orchestrator.d.ts.map