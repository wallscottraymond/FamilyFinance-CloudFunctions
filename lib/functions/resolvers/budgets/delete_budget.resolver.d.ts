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
import { DeleteBudgetDependencies } from "../../types/budgets/delete_budget.types";
/**
 * Resolves dependencies for deleting a budget.
 *
 * @param ctx - Trace context
 * @param user_id - User performing the delete
 * @param budget_id - Budget being deleted
 * @throws NotFoundError if the budget does not exist
 */
export declare function resolve_delete_budget_dependencies(ctx: TraceContext, user_id: string, budget_id: string): Promise<DeleteBudgetDependencies>;
//# sourceMappingURL=delete_budget.resolver.d.ts.map