/**
 * Create Goal Resolver — Goals (Phase 1)
 *
 * Read-only dependency analysis for creating a goal:
 *  - the linked account (baseline balance, ownership check, invest-type check)
 *  - the user's existing goals on that account (next priority rank + count)
 *
 * @module resolvers/goals/create_goal
 */
import { TraceContext } from "../../types";
import { CreateGoalInput } from "../../types/goals/goal_crud.types";
export interface CreateGoalDependencies {
    /** The linked account's current balance — captured as the goal baseline. */
    baseline_balance: number;
    /** Next priority rank on this account (existing max + 1; 0 when first). */
    priority_rank: number;
    /** How many goals already watch this account (for the FE "N other goals"). */
    existing_goals_on_account: number;
}
export declare function resolve_create_goal_dependencies(ctx: TraceContext, user_id: string, input: CreateGoalInput): Promise<CreateGoalDependencies>;
//# sourceMappingURL=create_goal.resolver.d.ts.map