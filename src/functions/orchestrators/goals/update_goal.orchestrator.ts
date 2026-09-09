/**
 * Update Goal Orchestrator — Goals (Phase 1)
 *
 * idempotency → load + ownership check → compute merge (pure) → persist.
 *
 * @module orchestrators/goals/update_goal
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { NotFoundError, PermissionDeniedError, ValidationError } from "../../types/errors";
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
import { compute_update_goal } from "../../domain/goals/goal.service";
import {
  UpdateGoalInput,
  UpdateGoalResponse,
} from "../../types/goals/goal_crud.types";

export async function update_goal_orchestrator(
  ctx: TraceContext,
  user_id: string,
  idempotency_key: string,
  input: UpdateGoalInput
): Promise<UpdateGoalResponse> {
  const span = create_span(ctx, "orchestrator", "update_goal");
  log_operation_start(span, user_id);

  const check = await check_idempotency(ctx, idempotency_key);
  if (check.is_duplicate) {
    if (check.status === "completed") {
      log_idempotent_return(span, user_id);
      return check.cached_result as UpdateGoalResponse;
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
    const existing = await goal_repo.get_by_id(ctx, input.goal_id);
    if (!existing) {
      throw new NotFoundError("goal", input.goal_id);
    }
    if (existing.owner_id !== user_id) {
      throw new PermissionDeniedError("update_goal", input.goal_id);
    }

    const computed = compute_update_goal({
      existing,
      input,
      now: Timestamp.now(),
    });
    if (computed.validation_errors || !computed.entity) {
      throw new ValidationError(computed.validation_errors ?? ["update failed"]);
    }

    await goal_repo.save(ctx, computed.entity);

    const response: UpdateGoalResponse = { goal_id: input.goal_id, updated: true };
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
