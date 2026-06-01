/**
 * Category Ownership Domain Service
 *
 * Pure, deterministic computation of category transfer plans. Categories are
 * system-wide but ownership is per-user: each user's budgets claim categories,
 * and unclaimed categories fall to the "Everything Else" budget.
 *
 * The resolver supplies the current ownership map (IO); this service computes
 * the diff. NO async, NO IO, NO side effects.
 *
 * @module domain/budgets/category_ownership
 */

import { DomainResult } from "../../types";

/**
 * A single category ownership transfer.
 */
export interface CategoryTransfer {
  category_id: string;
  /** Budget currently owning the category (null = Everything Else / unassigned) */
  from_budget_id: string | null;
  /** Budget that will own the category after the transfer */
  to_budget_id: string;
}

/**
 * A computed transfer plan: which categories to claim and which to release.
 */
export interface CategoryTransferPlan {
  /** Categories this budget will take ownership of */
  claims: CategoryTransfer[];
  /** Categories this budget gives up (released to Everything Else) */
  releases: CategoryTransfer[];
}

/**
 * Compute the transfer plan when a NEW budget claims its initial categories.
 *
 * Every requested category is claimed from its current owner (which may be the
 * Everything Else budget or unassigned).
 *
 * PURE FUNCTION.
 *
 * @param requested_category_ids - Categories the new budget wants
 * @param current_owners - Map of category_id → current owner budget_id (or null)
 * @param new_budget_id - The budget claiming the categories
 */
export function compute_create_transfer_plan(
  requested_category_ids: string[],
  current_owners: Record<string, string | null>,
  new_budget_id: string
): DomainResult<CategoryTransferPlan> {
  if (!new_budget_id) {
    return { validation_errors: ["new_budget_id is required"] };
  }

  const claims: CategoryTransfer[] = unique(requested_category_ids).map(
    (category_id) => ({
      category_id,
      from_budget_id: current_owners[category_id] ?? null,
      to_budget_id: new_budget_id,
    })
  );

  return { entity: { claims, releases: [] } };
}

/**
 * Compute the transfer plan when an EXISTING budget's categories change.
 *
 * - Added categories (new - current) are claimed from their current owners.
 * - Removed categories (current - new) are released to Everything Else.
 *
 * PURE FUNCTION.
 *
 * @param current_category_ids - Categories the budget owns today
 * @param next_category_ids - Categories the budget should own after update
 * @param current_owners - Map of category_id → current owner budget_id (or null)
 * @param budget_id - The budget being updated
 * @param everything_else_budget_id - Release target (null if none exists)
 */
export function compute_update_transfer_plan(
  current_category_ids: string[],
  next_category_ids: string[],
  current_owners: Record<string, string | null>,
  budget_id: string,
  everything_else_budget_id: string | null
): DomainResult<CategoryTransferPlan> {
  if (!budget_id) {
    return { validation_errors: ["budget_id is required"] };
  }

  const current_set = new Set(current_category_ids);
  const next_set = new Set(next_category_ids);

  const added = [...next_set].filter((c) => !current_set.has(c));
  const removed = [...current_set].filter((c) => !next_set.has(c));

  const claims: CategoryTransfer[] = added.map((category_id) => ({
    category_id,
    from_budget_id: current_owners[category_id] ?? null,
    to_budget_id: budget_id,
  }));

  const releases: CategoryTransfer[] = removed.map((category_id) => ({
    category_id,
    from_budget_id: budget_id,
    // null target means "return to Everything Else" — the repo resolves the
    // actual document; we record the known id when available.
    to_budget_id: everything_else_budget_id ?? "",
  }));

  return { entity: { claims, releases } };
}

/**
 * Compute the transfer plan when a budget is DELETED.
 *
 * All categories owned by the deleted budget are released back to Everything
 * Else. The system budget itself never owns transferable categories.
 *
 * PURE FUNCTION.
 *
 * @param owned_category_ids - Categories owned by the budget being deleted
 * @param budget_id - The budget being deleted
 * @param everything_else_budget_id - Release target (null if none exists)
 */
export function compute_delete_transfer_plan(
  owned_category_ids: string[],
  budget_id: string,
  everything_else_budget_id: string | null
): DomainResult<CategoryTransferPlan> {
  if (!budget_id) {
    return { validation_errors: ["budget_id is required"] };
  }

  const releases: CategoryTransfer[] = unique(owned_category_ids).map(
    (category_id) => ({
      category_id,
      from_budget_id: budget_id,
      to_budget_id: everything_else_budget_id ?? "",
    })
  );

  return { entity: { claims: [], releases } };
}

/**
 * Deduplicate a string array preserving first-seen order.
 *
 * PURE helper.
 */
function unique(values: string[]): string[] {
  return [...new Set(values)];
}
