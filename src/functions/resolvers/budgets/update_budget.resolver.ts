/**
 * Update Budget Resolver
 *
 * READ-ONLY impact analysis for updating a budget. Loads the existing budget,
 * computes category add/remove deltas, finds the Everything Else budget, and
 * detects amount changes. No mutations.
 *
 * @module resolvers/budgets/update_budget
 */

import { TraceContext } from "../../types";
import { NotFoundError } from "../../types/errors";
import {
  create_span,
  log_operation_start,
  log_operation_success,
} from "../../observability";
import { budget_repo } from "../../repositories/budget.repo";
import {
  UpdateBudgetInput,
  UpdateBudgetDependencies,
} from "../../types/budgets/update_budget.types";

/**
 * Resolves dependencies for updating a budget.
 *
 * @param ctx - Trace context
 * @param user_id - User performing the update
 * @param input - Normalized partial update input
 * @throws NotFoundError if the budget does not exist
 */
export async function resolve_update_budget_dependencies(
  ctx: TraceContext,
  user_id: string,
  input: UpdateBudgetInput
): Promise<UpdateBudgetDependencies> {
  const span = create_span(ctx, "resolver", "resolve_update_budget_dependencies");
  log_operation_start(span, user_id);

  const existing = await budget_repo.get_by_id(ctx, input.budget_id);
  if (!existing) {
    throw new NotFoundError("budget", input.budget_id);
  }

  // Category delta (only when category_ids is part of the update and this is
  // not the system budget, which manages categories automatically).
  let added_category_ids: string[] = [];
  let removed_category_ids: string[] = [];
  if (input.category_ids !== undefined && !existing.is_system_everything_else) {
    const current = new Set(existing.category_ids);
    const next = new Set(input.category_ids);
    added_category_ids = [...next].filter((c) => !current.has(c));
    removed_category_ids = [...current].filter((c) => !next.has(c));
  }

  const everything_else =
    removed_category_ids.length > 0
      ? await budget_repo.find_everything_else(ctx, user_id)
      : null;

  const amount_changed =
    input.amount !== undefined && input.amount !== existing.amount;

  log_operation_success(span, user_id);

  return {
    existing,
    added_category_ids,
    removed_category_ids,
    everything_else_budget_id: everything_else?.id ?? null,
    amount_changed,
  };
}
