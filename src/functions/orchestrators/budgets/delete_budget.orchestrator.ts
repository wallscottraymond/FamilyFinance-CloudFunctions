/**
 * Delete Budget Orchestrator
 *
 * Synchronous path for deleting a budget: idempotency → resolve → validate →
 * delete document → enqueue cascade. The cascade (period deletion, transaction
 * reassignment, category release) runs in process_budget_deleted.
 *
 * @module orchestrators/budgets/delete_budget
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
import { compute_delete_budget } from "../../domain/budgets/delete_budget.service";
import { resolve_delete_budget_dependencies } from "../../resolvers/budgets/delete_budget.resolver";
import {
  DeleteBudgetResponse,
  ProcessBudgetDeletedPayload,
} from "../../types/budgets/delete_budget.types";

/**
 * Deletes a budget.
 */
export async function delete_budget_orchestrator(
  ctx: TraceContext,
  user_id: string,
  idempotency_key: string,
  budget_id: string
): Promise<DeleteBudgetResponse> {
  const span = create_span(ctx, "orchestrator", "delete_budget");
  log_operation_start(span, user_id);

  const check = await check_idempotency(ctx, idempotency_key);
  if (check.is_duplicate) {
    if (check.status === "completed") {
      log_idempotent_return(span, user_id);
      return check.cached_result as DeleteBudgetResponse;
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
    // 1. Resolve dependencies (existing budget, periods, transactions, EE)
    const dependencies = await resolve_delete_budget_dependencies(
      ctx,
      user_id,
      budget_id
    );

    // 2. Domain validation + plan (pure) — blocks deleting Everything Else
    const computed = compute_delete_budget({
      user_id,
      dependencies,
      now: Timestamp.now(),
    });
    if (computed.validation_errors || !computed.entity) {
      throw new ValidationError(computed.validation_errors ?? ["delete failed"]);
    }
    const plan = computed.entity;

    // 3. Delete the budget document (cascade cleans up the rest)
    await budget_repo.hard_delete(ctx, budget_id, user_id);

    // 4. Enqueue the cascade job
    if (plan.requires_cascade) {
      const payload: ProcessBudgetDeletedPayload = {
        budget_id,
        user_id,
        group_ids: dependencies.existing.group_ids,
        budget_period_ids: dependencies.budget_period_ids,
        affected_transaction_ids: dependencies.affected_transaction_ids,
        release_category_ids: plan.release_category_ids,
        everything_else_budget_id: dependencies.everything_else_budget_id,
      };
      await create_job("process_budget_deleted", payload, { trace_id: ctx.trace_id });
    }

    const response: DeleteBudgetResponse = {
      budget_id,
      processing_background: plan.requires_cascade,
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
