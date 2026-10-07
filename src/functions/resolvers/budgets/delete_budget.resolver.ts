/**
 * Delete Budget Resolver
 *
 * READ-ONLY impact analysis for deleting a budget. Loads the budget, its
 * periods, the transactions whose splits reference it (for reassignment), the
 * categories it owns, and the Everything Else budget. No mutations.
 *
 * Transactions are found the same way as the legacy delete: scan the user's
 * active transactions and filter splits in memory (splits are nested, so they
 * cannot be queried directly). The cascade job re-queries authoritatively.
 *
 * @module resolvers/budgets/delete_budget
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
import { budget_period_repo } from "../../repositories/budget_period.repo";
import { transaction_repo } from "../../repositories/transaction.repo";
import { DeleteBudgetDependencies } from "../../types/budgets/delete_budget.types";
import { group_repo } from "../../repositories/sharing";
import { can_manage_budget, group_id_of_key } from "../../domain/sharing/budget_view.service";

/**
 * Resolves dependencies for deleting a budget.
 *
 * @param ctx - Trace context
 * @param user_id - User performing the delete
 * @param budget_id - Budget being deleted
 * @throws NotFoundError if the budget does not exist
 */
export async function resolve_delete_budget_dependencies(
  ctx: TraceContext,
  user_id: string,
  budget_id: string
): Promise<DeleteBudgetDependencies> {
  const span = create_span(ctx, "resolver", "resolve_delete_budget_dependencies");
  log_operation_start(span, user_id);

  const existing = await budget_repo.get_by_id(ctx, budget_id);
  // Ownership: a budget the caller can't manage is "not found" (don't reveal it
  // exists). The callables run with the admin SDK, so rules don't protect it.
  // Group budgets (owner key "group:<id>", PD6) are managed by any member.
  const owner_group_id = existing ? group_id_of_key(existing.user_id) : null;
  const owner_group = owner_group_id ? await group_repo.get(ctx, owner_group_id) : null;
  if (!existing || !can_manage_budget(existing.user_id, user_id, owner_group)) {
    throw new NotFoundError("budget", budget_id);
  }

  const [
    budget_period_ids,
    affected_transaction_ids,
    everything_else,
    pending_rollover_by_type,
  ] = await Promise.all([
    budget_period_repo.get_ids_by_budget_id(ctx, budget_id),
    // The budget's view (PD6): a person's own txns, none for a group key.
    transaction_repo.get_ids_referencing_budget(ctx, existing.user_id, budget_id),
    // Per-Period-EE: the EE for the deleted budget's lens (its released splits
    // re-home within that lens).
    budget_repo.find_everything_else(
      ctx,
      existing.user_id,
      budget_cadence_to_instance(existing.period)
    ),
    budget_period_repo.get_pending_rollover_by_type(ctx, budget_id),
  ]);

  log_operation_success(span, user_id);

  return {
    existing,
    budget_period_ids,
    affected_transaction_ids,
    owned_category_ids: existing.category_ids,
    everything_else_budget_id: everything_else?.id ?? null,
    pending_rollover_by_type,
  };
}
