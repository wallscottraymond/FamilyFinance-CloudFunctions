/**
 * Update Budget Orchestrator
 *
 * Synchronous path for updating a budget: idempotency → resolve → compute →
 * persist → enqueue cascade. Category transfer and period regeneration are
 * deferred to the process_budget_updated job.
 *
 * @module orchestrators/budgets/update_budget
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
import { compute_update_budget } from "../../domain/budgets/update_budget.service";
import {
  budget_cadence_to_instance,
  compute_period_generation_end,
} from "../../domain/budgets/period_generation.service";
import { resolve_update_budget_dependencies } from "../../resolvers/budgets/update_budget.resolver";
import {
  UpdateBudgetInput,
  UpdateBudgetResponse,
  ProcessBudgetUpdatedPayload,
} from "../../types/budgets/update_budget.types";

/**
 * Updates a budget.
 */
export async function update_budget_orchestrator(
  ctx: TraceContext,
  user_id: string,
  idempotency_key: string,
  input: UpdateBudgetInput
): Promise<UpdateBudgetResponse> {
  const span = create_span(ctx, "orchestrator", "update_budget");
  log_operation_start(span, user_id);

  const check = await check_idempotency(ctx, idempotency_key);
  if (check.is_duplicate) {
    if (check.status === "completed") {
      log_idempotent_return(span, user_id);
      return check.cached_result as UpdateBudgetResponse;
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
    // 1. Resolve (loads existing budget + category deltas)
    const dependencies = await resolve_update_budget_dependencies(ctx, user_id, input);

    // 2. Domain computation (pure) — enforces guardrails, recomputes remaining
    const computed = compute_update_budget({
      user_id,
      input,
      dependencies,
      now: Timestamp.now(),
    });
    if (computed.validation_errors || !computed.entity) {
      throw new ValidationError(computed.validation_errors ?? ["update failed"]);
    }
    const entity = computed.entity;

    // 3. Persist the updated budget document
    await budget_repo.save(ctx, entity);

    // 4. Build claims for added categories from the resolved owner map.
    const added_claims = dependencies.added_category_ids.map((category_id) => ({
      category_id,
      from_budget_id: null as string | null,
    }));

    // 5. Enqueue cascade (claims/releases + period reallocation + rename)
    const name_changed = entity.name !== dependencies.existing.name;
    const needs_cascade =
      added_claims.length > 0 ||
      dependencies.removed_category_ids.length > 0 ||
      dependencies.amount_changed ||
      name_changed;

    if (needs_cascade) {
      const generation_end = compute_period_generation_end(
        entity.start_date.toDate(),
        entity.is_ongoing,
        entity.budget_end_date ? entity.budget_end_date.toDate() : null
      );
      const payload: ProcessBudgetUpdatedPayload = {
        budget_id: entity.id,
        user_id,
        group_ids: entity.group_ids,
        budget_name: entity.name,
        category_ids: entity.category_ids,
        amount: entity.amount,
        cadence: budget_cadence_to_instance(entity.period),
        start_ms: entity.start_date.toMillis(),
        generation_end_ms: generation_end.getTime(),
        is_recurring: entity.is_ongoing,
        added_claims,
        released_category_ids: dependencies.removed_category_ids,
        everything_else_budget_id: dependencies.everything_else_budget_id,
        regenerate_periods: dependencies.amount_changed,
        name_changed,
      };
      await create_job("process_budget_updated", payload, { trace_id: ctx.trace_id });
    }

    const response: UpdateBudgetResponse = {
      budget_id: entity.id,
      name: entity.name,
      amount: entity.amount,
      category_ids: entity.category_ids,
      period: entity.period,
      categories_claimed: added_claims.length,
      categories_released: dependencies.removed_category_ids.length,
      processing_background: needs_cascade,
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
