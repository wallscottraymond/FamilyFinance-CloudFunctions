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
import { UpdateBudgetInput, UpdateBudgetDependencies } from "../../types/budgets/update_budget.types";
/**
 * Resolves dependencies for updating a budget.
 *
 * @param ctx - Trace context
 * @param user_id - User performing the update
 * @param input - Normalized partial update input
 * @throws NotFoundError if the budget does not exist
 */
export declare function resolve_update_budget_dependencies(ctx: TraceContext, user_id: string, input: UpdateBudgetInput): Promise<UpdateBudgetDependencies>;
//# sourceMappingURL=update_budget.resolver.d.ts.map