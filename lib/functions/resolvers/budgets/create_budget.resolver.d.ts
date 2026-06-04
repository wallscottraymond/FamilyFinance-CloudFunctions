/**
 * Create Budget Resolver
 *
 * READ-ONLY impact analysis for creating a budget. Resolves currency, sharing
 * groups, the user's budget count, current category ownership, and the
 * Everything Else budget. No mutations.
 *
 * @module resolvers/budgets/create_budget
 */
import { TraceContext } from "../../types";
import { CreateBudgetInput, CreateBudgetDependencies } from "../../types/budgets/create_budget.types";
/**
 * Resolves dependencies for creating a budget.
 *
 * @param ctx - Trace context
 * @param user_id - User creating the budget
 * @param input - Normalized create input
 */
export declare function resolve_create_budget_dependencies(ctx: TraceContext, user_id: string, input: CreateBudgetInput): Promise<CreateBudgetDependencies>;
//# sourceMappingURL=create_budget.resolver.d.ts.map