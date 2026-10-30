/**
 * Migrate Budget Categories (canon A2, Transaction-Integrity-Review 3c) — one-time, admin-run.
 *
 *   1. DRY RUN: plan every active budget's change (→ first-category slugs; Everything Else → no
 *      list) and write the report to `_migration_reports/{run_id}` for the user to review.
 *   2. APPLY (only with a reviewed dry run's `run_id`): re-plan; refuse if anything differs from
 *      the reviewed report; snapshot every budget's current list to `_migration_snapshots/{run_id}`
 *      (the undo record); write each change only if that budget is still exactly as reviewed;
 *      then re-assign every view whose REAL budgets changed (bounded engine) — Everything Else
 *      lists never affected matching, so clearing them re-assigns nothing.
 *
 * @module orchestrators/budgets/migrate_budget_categories
 */
import { TraceContext } from "../../types";
export interface MigrateBudgetCategoriesInput {
    dry_run: boolean;
    /** Apply only: the reviewed dry run. */
    reviewed_run_id?: string;
}
export interface MigrateBudgetCategoriesResult {
    run_id: string;
    dry_run: boolean;
    changes: number;
    flags: number;
    applied?: number;
    skipped_changed_since?: string[];
}
export declare function migrate_budget_categories_orchestrator(ctx: TraceContext, input: MigrateBudgetCategoriesInput): Promise<MigrateBudgetCategoriesResult>;
//# sourceMappingURL=migrate_budget_categories.orchestrator.d.ts.map