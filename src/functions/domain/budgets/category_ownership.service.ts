/**
 * Category Ownership Domain Service
 *
 * Pure claim planning: one budget per category PER VIEW (canon A3 / A3b). The resolver
 * supplies the view's budgets (IO); this service decides who a take comes from and refuses one
 * that would leave a budget empty. NO async, NO IO, NO side effects.
 *
 * @module domain/budgets/category_ownership
 */

import { DomainResult } from "../../types";

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
