/**
 * migrate_budget_categories (admin) — canon A2 one-time migration, dry run first.
 *
 *   { dry_run: true }                          → report in `_migration_reports/{run_id}`
 *   { dry_run: false, reviewed_run_id: "…" }   → apply exactly the reviewed plan
 *
 * Requires the `admin` custom claim. Returns counts + the run id.
 *
 * @module entry/callable/migrate_budget_categories
 */
export declare const migrate_budget_categories: import("firebase-functions/v2/https").CallableFunction<any, Promise<import("../../orchestrators/budgets/migrate_budget_categories.orchestrator").MigrateBudgetCategoriesResult>, unknown>;
//# sourceMappingURL=migrate_budget_categories.entry.d.ts.map