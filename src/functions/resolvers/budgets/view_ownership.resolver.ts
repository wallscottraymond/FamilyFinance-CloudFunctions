/**
 * View ownership inputs (canon A3 — one budget per category PER VIEW): a view's budgets as the
 * claim planner needs them, and what first category each id they store means (slugs and legacy
 * Plaid codes alike), from the module-cached category catalog.
 *
 * @module resolvers/budgets/view_ownership
 */

import { TraceContext } from "../../types";
import { BudgetEntity } from "../../types/budgets/budget_entity.types";
import { load_category_catalog } from "../shared/category_catalog.resolver";

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

export async function resolve_view_ownership(
  ctx: TraceContext,
  budgets: BudgetEntity[],
  extra_category_ids: string[] = []
): Promise<ViewOwnership> {
  const catalog = await load_category_catalog(ctx);
  const first_by_category: Record<string, string> = {};
  const note = (id: string) => {
    const first =
      catalog.slugs_by_plaid[id]?.first_category_id ?? (id in catalog.plaid_by_first ? id : null);
    if (first) first_by_category[id] = first;
  };
  for (const b of budgets) b.category_ids.forEach(note);
  extra_category_ids.forEach(note);
  return {
    view_budgets: budgets.map((b) => ({
      id: b.id,
      name: b.name,
      category_ids: b.category_ids ?? [],
      is_everything_else: b.is_system_everything_else === true,
      start_ms: b.start_date.toMillis(),
    })),
    first_by_category,
  };
}
