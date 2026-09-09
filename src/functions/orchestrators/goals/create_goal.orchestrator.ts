/**
 * Create Goal Orchestrator — Goals (Phase 1)
 *
 * idempotency → resolve (account baseline + priority rank) → compute (pure) →
 * persist. Observe-only: no money movement, no cascade job (measurement is
 * derive-on-read from balance snapshots).
 *
 * @module orchestrators/goals/create_goal
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { ValidationError } from "../../types/errors";
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
import { resolve_create_goal_dependencies } from "../../resolvers/goals/create_goal.resolver";
import { compute_create_goal } from "../../domain/goals/goal.service";
import {
  CreateGoalInput,
  CreateGoalResponse,
} from "../../types/goals/goal_crud.types";

export async function create_goal_orchestrator(
  ctx: TraceContext,
  user_id: string,
  idempotency_key: string,
  input: CreateGoalInput
): Promise<CreateGoalResponse> {
  const span = create_span(ctx, "orchestrator", "create_goal");
  log_operation_start(span, user_id);

  const check = await check_idempotency(ctx, idempotency_key);
  if (check.is_duplicate) {
    if (check.status === "completed") {
      log_idempotent_return(span, user_id);
      return check.cached_result as CreateGoalResponse;
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
    // 1. Resolve dependencies (read-only)
    const deps = await resolve_create_goal_dependencies(ctx, user_id, input);

    // 2. Domain computation (pure)
    const goal_id = goal_repo.new_id();
    const computed = compute_create_goal({
      goal_id,
      user_id,
      input,
      baseline_balance: deps.baseline_balance,
      priority_rank: deps.priority_rank,
      now: Timestamp.now(),
    });
    if (computed.validation_errors || !computed.entity) {
      throw new ValidationError(computed.validation_errors ?? ["create failed"]);
    }
    const entity = computed.entity;

    // 3. Persist
    await goal_repo.save(ctx, entity);

    // 4. Response
    const response: CreateGoalResponse = {
      goal_id,
      goal_type: entity.goal_type,
      name: entity.name,
      linked_account_id: entity.linked_account_id,
      target_amount: entity.target_amount ?? null,
      per_period_amount: entity.per_period_amount,
      home_cadence: entity.home_cadence,
      priority_rank: entity.priority_rank,
      baseline_balance: entity.baseline_balance,
    };
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
