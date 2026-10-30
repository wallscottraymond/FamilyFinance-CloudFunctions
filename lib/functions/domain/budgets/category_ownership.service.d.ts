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
export declare function plan_view_claims(input: {
    budget_id: string;
    added_category_ids: string[];
    view_budgets: ViewBudgetForClaims[];
    first_of: (category_id: string) => string | null;
}): DomainResult<{
    claims: ViewClaim[];
}>;
//# sourceMappingURL=category_ownership.service.d.ts.map