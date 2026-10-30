/**
 * Budget category migration (canon A2, Transaction-Integrity-Review 3c) — PURE.
 *
 * Every budget's `categoryIds` becomes `firstCategoryId` slugs:
 *   - Everything Else → [] (it stores no list — it's the structural fallback);
 *   - a slug stays;
 *   - Plaid detailed codes that cover ALL of a first's codes → that first's slug;
 *   - codes covering only PART of a first → FLAGGED and left as they are (A2: flagged, never
 *     silently widened to the whole first) — the user fixes it in Edit categories;
 *   - an overall slug or an unknown id → flagged, left as is.
 * A real budget whose result is empty is flagged (canon A3b) and not changed.
 */
import { CategoryCatalog } from "../transactions/split_category.service";
export interface BudgetForMigration {
    id: string;
    owner_key: string;
    name: string;
    category_ids: string[];
    is_everything_else: boolean;
}
export interface BudgetMigrationChange {
    budget_id: string;
    owner_key: string;
    name: string;
    before: string[];
    after: string[];
}
export interface BudgetMigrationFlag {
    budget_id: string;
    owner_key: string;
    name: string;
    reason: "partial_first" | "overall_slug" | "unknown_id" | "no_categories";
    ids: string[];
}
export declare function plan_budget_category_migration(budgets: BudgetForMigration[], catalog: CategoryCatalog): {
    changes: BudgetMigrationChange[];
    flags: BudgetMigrationFlag[];
};
//# sourceMappingURL=budget_category_migration.service.d.ts.map