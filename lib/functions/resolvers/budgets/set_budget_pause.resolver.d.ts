/**
 * set_budget_pause resolver (read-only): the budget being paused, if the caller may manage it.
 * Group budgets (owner key "group:<id>") are managed by any member, like every budget edit.
 *
 * @module resolvers/budgets/set_budget_pause
 */
import { TraceContext } from "../../types";
import { BudgetEntity } from "../../types/budgets/budget_entity.types";
export declare function resolve_set_budget_pause_dependencies(ctx: TraceContext, user_id: string, budget_id: string): Promise<{
    existing: BudgetEntity;
}>;
//# sourceMappingURL=set_budget_pause.resolver.d.ts.map