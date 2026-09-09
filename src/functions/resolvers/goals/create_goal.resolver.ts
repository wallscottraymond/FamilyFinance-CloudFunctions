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
import { NotFoundError, PermissionDeniedError, ValidationError } from "../../types/errors";
import { account_repo } from "../../repositories/account.repo";
import { goal_repo } from "../../repositories/goal.repo";
import { CreateGoalInput } from "../../types/goals/goal_crud.types";

export interface CreateGoalDependencies {
  /** The linked account's current balance — captured as the goal baseline. */
  baseline_balance: number;
  /** Next priority rank on this account (existing max + 1; 0 when first). */
  priority_rank: number;
  /** How many goals already watch this account (for the FE "N other goals"). */
  existing_goals_on_account: number;
}

export async function resolve_create_goal_dependencies(
  ctx: TraceContext,
  user_id: string,
  input: CreateGoalInput
): Promise<CreateGoalDependencies> {
  // 1. The linked account must exist and be owned by the caller.
  const account = await account_repo.get_by_id(ctx, input.linked_account_id);
  if (!account) {
    throw new NotFoundError("account", input.linked_account_id);
  }
  if (account.access.owner_id !== user_id) {
    throw new PermissionDeniedError("create_goal", input.linked_account_id);
  }

  // 2. Invest goals must target an investment account.
  if (input.goal_type === "invest" && account.account_type !== "investment") {
    throw new ValidationError([
      "An Invest goal must be linked to an investment account",
    ]);
  }

  // 3. Existing goals on this account → priority rank (fill order) + count.
  const existing = await goal_repo.get_by_account(
    ctx,
    user_id,
    input.linked_account_id
  );
  const max_rank = existing.reduce(
    (m, g) => Math.max(m, g.priority_rank),
    -1
  );

  return {
    baseline_balance: account.balances.current ?? 0,
    priority_rank: max_rank + 1,
    existing_goals_on_account: existing.length,
  };
}
