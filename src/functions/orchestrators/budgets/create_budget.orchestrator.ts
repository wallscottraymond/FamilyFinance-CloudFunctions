/**
 * Create Budget Orchestrator
 *
 * Synchronous path for creating a budget: idempotency → resolve → compute →
 * persist → enqueue cascade. Heavy work (category transfer, period generation)
 * is deferred to the process_budget_created job.
 *
 * @module orchestrators/budgets/create_budget
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
import { create_job } from "../../infrastructure/job_queue";
import { budget_repo } from "../../repositories/budget.repo";
import { compute_create_budget } from "../../domain/budgets/create_budget.service";
import { compute_create_transfer_plan } from "../../domain/budgets/category_ownership.service";
import {
  budget_cadence_to_instance,
  compute_period_generation_end,
} from "../../domain/budgets/period_generation.service";
import { resolve_create_budget_dependencies } from "../../resolvers/budgets/create_budget.resolver";
import {
  CreateBudgetInput,
  CreateBudgetResponse,
  ProcessBudgetCreatedPayload,
} from "../../types/budgets/create_budget.types";

/**
 * Creates a budget.
 *
 * @param ctx - Trace context
 * @param user_id - User creating the budget
 * @param idempotency_key - Client idempotency key
 * @param input - Normalized create input
 */
export async function create_budget_orchestrator(
  ctx: TraceContext,
  user_id: string,
  idempotency_key: string,
  input: CreateBudgetInput
): Promise<CreateBudgetResponse> {
  const span = create_span(ctx, "orchestrator", "create_budget");
  log_operation_start(span, user_id);

  // 1. Idempotency check
  const check = await check_idempotency(ctx, idempotency_key);
  if (check.is_duplicate) {
    if (check.status === "completed") {
      log_idempotent_return(span, user_id);
      return check.cached_result as CreateBudgetResponse;
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
    // 2. Resolve dependencies (read-only)
    const dependencies = await resolve_create_budget_dependencies(ctx, user_id, input);

    // 3. Domain computation (pure)
    const budget_id = budget_repo.new_id();
    const computed = compute_create_budget({
      budget_id,
      user_id,
      input,
      dependencies,
      now: Timestamp.now(),
    });
    if (computed.validation_errors || !computed.entity) {
      throw new ValidationError(computed.validation_errors ?? ["create failed"]);
    }
    const entity = computed.entity;

    // 4. Persist the budget document
    await budget_repo.save(ctx, entity);

    // 5. Compute the category transfer plan (pure)
    const plan = compute_create_transfer_plan(
      entity.category_ids,
      dependencies.category_owners,
      budget_id
    );

    // 6. Enqueue the cascade job (category transfer + period generation).
    // Generation spans the full horizon (12mo ahead for ongoing budgets), NOT
    // the budget's nominal one-period end_date.
    const generation_end = compute_period_generation_end(
      entity.start_date.toDate(),
      entity.is_ongoing,
      entity.budget_end_date ? entity.budget_end_date.toDate() : null
    );
    const payload: ProcessBudgetCreatedPayload = {
      budget_id,
      user_id,
      group_ids: entity.group_ids,
      budget_name: entity.name,
      amount: entity.amount,
      cadence: budget_cadence_to_instance(entity.period),
      start_ms: entity.start_date.toMillis(),
      generation_end_ms: generation_end.getTime(),
      is_recurring: entity.is_ongoing,
      claims: plan.entity?.claims.map((c) => ({
        category_id: c.category_id,
        from_budget_id: c.from_budget_id,
      })) ?? [],
      everything_else_budget_id: dependencies.everything_else_budget_id,
    };
    await create_job("process_budget_created", payload, { trace_id: ctx.trace_id });

    // 7. Build response and complete idempotency key
    const response: CreateBudgetResponse = {
      budget_id,
      name: entity.name,
      amount: entity.amount,
      currency: entity.currency,
      category_ids: entity.category_ids,
      period: entity.period,
      is_shared: !entity.is_private,
      categories_claimed: payload.claims.length,
      processing_background: true,
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
