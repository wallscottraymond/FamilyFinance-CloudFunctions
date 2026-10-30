/**
 * View ownership inputs (canon A3 — one budget per category PER VIEW): a view's budgets as the
 * claim planner needs them, and what first category each id they store means (slugs and legacy
 * Plaid codes alike), from the module-cached category catalog.
 *
 * @module resolvers/budgets/view_ownership
 */
import { TraceContext } from "../../types";
import { BudgetEntity } from "../../types/budgets/budget_entity.types";
export interface ViewOwnership {
    view_budgets: Array<{
        id: string;
        name: string;
        category_ids: string[];
        is_everything_else: boolean;
        start_ms: number;
    }>;
    first_by_category: Record<string, string>;
}
export declare function resolve_view_ownership(ctx: TraceContext, budgets: BudgetEntity[], extra_category_ids?: string[]): Promise<ViewOwnership>;
//# sourceMappingURL=view_ownership.resolver.d.ts.map