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
import { budget_cadence_to_instance } from "../../domain/budgets";
import {
  UpdateBudgetInput,
  UpdateBudgetDependencies,
} from "../../types/budgets/update_budget.types";
import { group_repo } from "../../repositories/sharing";
import { can_manage_budget, group_id_of_key } from "../../domain/sharing/budget_view.service";

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
  // Ownership: a budget the caller can't manage is "not found" (don't reveal it
  // exists). The callables run with the admin SDK, so rules don't protect it.
  // Group budgets (owner key "group:<id>", PD6) are managed by any member.
  const owner_group_id = existing ? group_id_of_key(existing.user_id) : null;
  const owner_group = owner_group_id ? await group_repo.get(ctx, owner_group_id) : null;
  if (!existing || !can_manage_budget(existing.user_id, user_id, owner_group)) {
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
      ? await budget_repo.find_everything_else(
          ctx,
          existing.user_id, // the budget's view (PD6), not the caller
          budget_cadence_to_instance(existing.period) // this budget's lens
        )
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
