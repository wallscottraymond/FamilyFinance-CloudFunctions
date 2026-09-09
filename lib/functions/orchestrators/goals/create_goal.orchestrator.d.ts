/**
 * Create Goal Orchestrator — Goals (Phase 1)
 *
 * idempotency → resolve (account baseline + priority rank) → compute (pure) →
 * persist. Observe-only: no money movement, no cascade job (measurement is
 * derive-on-read from balance snapshots).
 *
 * @module orchestrators/goals/create_goal
 */
import { TraceContext } from "../../types";
import { CreateGoalInput, CreateGoalResponse } from "../../types/goals/goal_crud.types";
export declare function create_goal_orchestrator(ctx: TraceContext, user_id: string, idempotency_key: string, input: CreateGoalInput): Promise<CreateGoalResponse>;
//# sourceMappingURL=create_goal.orchestrator.d.ts.map