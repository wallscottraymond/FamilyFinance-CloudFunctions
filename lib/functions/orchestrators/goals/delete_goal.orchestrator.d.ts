/**
 * Delete Goal Orchestrator — Goals (Phase 1)
 *
 * idempotency → load + ownership check → soft-delete (deactivate + archive).
 * Soft delete keeps history and is recoverable; goals observe balances, so
 * there is no spend/period cascade to unwind.
 *
 * @module orchestrators/goals/delete_goal
 */
import { TraceContext } from "../../types";
import { DeleteGoalResponse } from "../../types/goals/goal_crud.types";
export declare function delete_goal_orchestrator(ctx: TraceContext, user_id: string, idempotency_key: string, goal_id: string): Promise<DeleteGoalResponse>;
//# sourceMappingURL=delete_goal.orchestrator.d.ts.map