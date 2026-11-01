/**
 * set_budget_pause resolver (read-only): the budget being paused, if the caller may manage it.
 * Group budgets (owner key "group:<id>") are managed by any member, like every budget edit.
 *
 * @module resolvers/budgets/set_budget_pause
 */

import { TraceContext } from "../../types";
import { NotFoundError } from "../../types/errors";
import { create_span, log_operation_start, log_operation_success } from "../../observability";
import { budget_repo } from "../../repositories/budget.repo";
import { group_repo } from "../../repositories/sharing";
import { can_manage_budget, group_id_of_key } from "../../domain/sharing/budget_view.service";
import { BudgetEntity } from "../../types/budgets/budget_entity.types";

export async function resolve_set_budget_pause_dependencies(
  ctx: TraceContext,
  user_id: string,
  budget_id: string
): Promise<{ existing: BudgetEntity }> {
  const span = create_span(ctx, "resolver", "resolve_set_budget_pause_dependencies");
  log_operation_start(span, user_id);
  const existing = await budget_repo.get_by_id(ctx, budget_id);
  const owner_group_id = existing ? group_id_of_key(existing.user_id) : null;
  const owner_group = owner_group_id ? await group_repo.get(ctx, owner_group_id) : null;
  // A budget the caller can't manage is "not found" (don't reveal it exists).
  if (!existing || !existing.is_active || !can_manage_budget(existing.user_id, user_id, owner_group)) {
    throw new NotFoundError("budget", budget_id);
  }
  log_operation_success(span, user_id);
  return { existing };
}
