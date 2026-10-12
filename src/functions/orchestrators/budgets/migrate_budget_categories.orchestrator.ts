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
import { generate_id } from "../../observability";
import { budget_repo } from "../../repositories/budget.repo";
import { migration_report_repo } from "../../repositories/migration_report.repo";
import { load_category_catalog } from "../../resolvers/shared/category_catalog.resolver";
import {
  BudgetMigrationChange,
  plan_budget_category_migration,
} from "../../domain/budgets/budget_category_migration.service";
import { reassign_view } from "../sharing/view_reassign";

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


export async function migrate_budget_categories_orchestrator(
  ctx: TraceContext,
  input: MigrateBudgetCategoriesInput
): Promise<MigrateBudgetCategoriesResult> {
  const [budgets, catalog] = await Promise.all([
    budget_repo.get_all_active(ctx),
    load_category_catalog(ctx),
  ]);
  const plan = plan_budget_category_migration(
    budgets.map((b) => ({
      id: b.id,
      owner_key: b.user_id,
      name: b.name,
      category_ids: b.category_ids ?? [],
      is_everything_else: b.is_system_everything_else === true,
    })),
    catalog
  );

  if (input.dry_run) {
    const run_id = generate_id();
    await migration_report_repo.save_report(run_id, {
      kind: "budget_categories_A2",
      dry_run: true,
      changes: plan.changes,
      flags: plan.flags,
    });
    return { run_id, dry_run: true, changes: plan.changes.length, flags: plan.flags.length };
  }

  // APPLY — only what the user reviewed.
  if (!input.reviewed_run_id) throw new Error("Apply needs the reviewed dry run's run_id");
  const reviewed = await migration_report_repo.get_report(input.reviewed_run_id);
  if (!reviewed || reviewed.dry_run !== true) throw new Error("Reviewed dry run not found");
  const reviewed_changes = reviewed.changes as BudgetMigrationChange[];

  // Compare as SETS of (budget, before, after) — independent of field / list order. A re-run
  // after a crash mid-apply is fine: the budgets already applied simply aren't in the new plan.
  const key = (c: BudgetMigrationChange) => `${c.budget_id}|${c.before.join(",")}|${c.after.join(",")}`;
  const reviewed_keys = new Set(reviewed_changes.map(key));
  const unreviewed = plan.changes.filter((c) => !reviewed_keys.has(key(c)));
  if (unreviewed.length > 0) {
    throw new Error("Budgets changed since the dry run — run a new dry run and review it");
  }
  // Every reviewed budget must still be as reviewed (pending) or already migrated (applied).
  const current = new Map(budgets.map((b) => [b.id, (b.category_ids ?? []).join(",")]));
  const drifted = reviewed_changes.filter((c) => {
    const now = current.get(c.budget_id);
    return now !== undefined && now !== c.before.join(",") && now !== c.after.join(",");
  });
  if (drifted.length > 0) {
    throw new Error("Budgets changed since the dry run — run a new dry run and review it");
  }

  const run_id = input.reviewed_run_id;
  await migration_report_repo.save_snapshot_once(run_id, {
    kind: "budget_categories_A2",
    budgets: Object.fromEntries(reviewed_changes.map((c) => [c.budget_id, c.before])),
  });

  let applied = 0;
  const skipped: string[] = [];
  const views_to_reassign = new Set<string>();
  const real = new Set(budgets.filter((b) => !b.is_system_everything_else).map((b) => b.id));
  for (const c of plan.changes) {
    const ok = await budget_repo.replace_category_ids_if_unchanged(ctx, c.budget_id, c.before, c.after);
    if (!ok) {
      skipped.push(c.budget_id);
      continue;
    }
    applied++;
  }
  // Re-assign every view whose REAL budgets the reviewed plan changes (idempotent — a re-run
  // after a crash covers views whose budgets were written before it).
  for (const c of reviewed_changes) if (real.has(c.budget_id)) views_to_reassign.add(c.owner_key);
  for (const owner_key of views_to_reassign) await reassign_view(ctx, owner_key);

  await migration_report_repo.mark_applied(run_id, { applied, skipped_changed_since: skipped });
  return {
    run_id,
    dry_run: false,
    changes: plan.changes.length,
    flags: plan.flags.length,
    applied,
    skipped_changed_since: skipped,
  };
}
