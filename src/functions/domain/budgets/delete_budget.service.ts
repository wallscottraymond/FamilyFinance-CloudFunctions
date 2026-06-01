/**
 * Delete Budget Domain Service
 *
 * Pure, deterministic validation and planning for a budget deletion. Decides
 * whether the delete is allowed and what cascade work must be scheduled.
 * NO async, NO IO, NO side effects.
 *
 * @module domain/budgets/delete_budget
 */

import { DomainResult } from "../../types";
import {
  DeleteBudgetComputeInput,
  DeleteBudgetPlan,
} from "../../types/budgets/delete_budget.types";

/**
 * Compute the delete plan for a budget.
 *
 * PURE FUNCTION.
 *
 * @param compute - Identity, resolved deps, and clock
 * @returns The delete plan or validation errors
 */
export function compute_delete_budget(
  compute: DeleteBudgetComputeInput
): DomainResult<DeleteBudgetPlan> {
  const { user_id, dependencies } = compute;
  const existing = dependencies.existing;
  const validation_errors: string[] = [];

  if (!user_id) {
    validation_errors.push("user_id is required");
  }

  // The system "Everything Else" budget cannot be deleted - it is the
  // reassignment target for every other budget's categories.
  if (existing.is_system_everything_else) {
    validation_errors.push("The 'Everything Else' budget cannot be deleted");
  }

  if (validation_errors.length > 0) {
    return { validation_errors };
  }

  const release_category_ids = unique(dependencies.owned_category_ids);

  const requires_cascade =
    dependencies.budget_period_ids.length > 0 ||
    dependencies.affected_transaction_ids.length > 0 ||
    release_category_ids.length > 0;

  const plan: DeleteBudgetPlan = {
    budget_id: existing.id,
    release_category_ids,
    requires_cascade,
  };

  return { entity: plan };
}

/**
 * Deduplicate a string array preserving first-seen order.
 *
 * PURE helper.
 */
function unique(values: string[]): string[] {
  return [...new Set(values)];
}
