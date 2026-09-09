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
import { NotFoundError, PermissionDeniedError } from "../../types/errors";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_idempotent_return,
} from "../../observability";
import {
  check_idempotency,
  claim_key,
  complete_key,
  fail_key,
} from "../../infrastructure/idempotency_store";
import { goal_repo } from "../../repositories/goal.repo";
import { DeleteGoalResponse } from "../../types/goals/goal_crud.types";

export async function delete_goal_orchestrator(
  ctx: TraceContext,
  user_id: string,
  idempotency_key: string,
  goal_id: string
): Promise<DeleteGoalResponse> {
  const span = create_span(ctx, "orchestrator", "delete_goal");
  log_operation_start(span, user_id);

  const check = await check_idempotency(ctx, idempotency_key);
  if (check.is_duplicate) {
    if (check.status === "completed") {
      log_idempotent_return(span, user_id);
      return check.cached_result as DeleteGoalResponse;
    }
    if (check.status === "in_progress") {
      throw new Error("Request already in progress");
    }
  }

  const claimed = await claim_key(ctx, idempotency_key);
  if (!claimed) {
    throw new Error("Request already in progress");
  }

  try {
    const existing = await goal_repo.get_by_id(ctx, goal_id);
    if (!existing) {
      throw new NotFoundError("goal", goal_id);
    }
    if (existing.owner_id !== user_id) {
      throw new PermissionDeniedError("delete_goal", goal_id);
    }

    await goal_repo.soft_delete(ctx, goal_id);

    const response: DeleteGoalResponse = { goal_id, deleted: true };
    await complete_key(ctx, idempotency_key, response);

    log_operation_success(span, user_id);
    return response;
  } catch (error) {
    await fail_key(
      ctx,
      idempotency_key,
      error instanceof Error ? error.message : "Unknown error"
    );
    throw error;
  }
}
