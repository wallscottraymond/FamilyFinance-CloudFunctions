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

/** A budget in the SAME view, reduced to what claiming needs (canon A3: one owner per view). */
export interface ViewBudgetForClaims {
  id: string;
  name: string;
  category_ids: string[];
  is_everything_else: boolean;
}

/** One category id to remove from a source budget (the id it actually stores). */
export interface ViewClaim {
  category_id: string;
  from_budget_id: string | null;
}

/**
 * Plan the claims when a budget takes categories (create or edit) — canon A3 / A3b:
 *   - ownership is PER VIEW (only `view_budgets`, i.e. the same Me / group owner key);
 *   - compared by FIRST category (`first_of`), so taking "groceries" also takes a legacy
 *     `FOOD_AND_DRINK_GROCERIES` another budget still stores (it's removed there);
 *   - a take can't leave another real budget with NO categories (A3b: ≥ 1 always) — the user
 *     must give that budget another category first;
 *   - Everything Else is never a real owner (it's the fallback).
 * Returns one claim per id removed from a source, plus `from_budget_id: null` for added
 * categories nobody owned.
 *
 * PURE FUNCTION.
 */
export function plan_view_claims(input: {
  budget_id: string;
  added_category_ids: string[];
  view_budgets: ViewBudgetForClaims[];
  first_of: (category_id: string) => string | null;
}): DomainResult<{ claims: ViewClaim[] }> {
  const key = (id: string) => input.first_of(id) ?? id;
  const wanted = new Set(unique(input.added_category_ids).map(key));
  const claims: ViewClaim[] = [];
  const errors: string[] = [];
  const owned = new Set<string>();

  for (const b of input.view_budgets) {
    if (b.id === input.budget_id || b.is_everything_else) continue;
    const taken = b.category_ids.filter((id) => wanted.has(key(id)));
    if (taken.length === 0) continue;
    if (taken.length === b.category_ids.length) {
      errors.push(
        `"${b.name}" would have no categories left. Give it another category first, ` +
          "or delete it."
      );
      continue;
    }
    for (const id of taken) {
      claims.push({ category_id: id, from_budget_id: b.id });
      owned.add(key(id));
    }
  }
  if (errors.length) return { validation_errors: errors };

  for (const id of unique(input.added_category_ids)) {
    if (!owned.has(key(id))) claims.push({ category_id: id, from_budget_id: null });
  }
  return { entity: { claims } };
}
