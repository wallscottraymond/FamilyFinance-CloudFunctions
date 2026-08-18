/**
 * Merge Assignment onto Raw Splits
 *
 * Pure helper shared by the single-item (`assign_transaction`) and batch
 * (`assign_transactions_batch`) orchestrators: merges the engine's computed
 * assignment back onto the raw camelCase split maps (so the write preserves
 * fields the engine doesn't own) and denormalizes the matched budget's name.
 *
 * Kept in ONE place so the skip-if-unchanged / name-heal semantics can't drift
 * between the two call sites.
 *
 * @module orchestrators/transactions/merge_assignment
 */

import { Timestamp } from "firebase-admin/firestore";
import { ResolvedAssignment } from "../../resolvers/transactions/assignment_context.resolver";
import {
  TransactionAssignmentResult,
} from "../../domain/transactions/compute_transaction_assignment.service";

/** The merged splits plus the signals the orchestrators branch on. */
export interface MergedAssignment {
  /** Raw split maps with the engine-owned fields + budgetName merged in. */
  updated_splits: Array<Record<string, unknown>>;
  /**
   * True when only `budgetName` drifted (assignment unchanged). The caller still
   * writes (display heal) but does NOT fan out a recompute (spend unmoved).
   */
  name_changed: boolean;
  /** Distinct budget ids across the splits (the denormalized `splitBudgetIds`). */
  split_budget_ids: string[];
  /**
   * Distinct recurring ids the splits are linked to (denormalized
   * `splitOutflowIds` / `splitInflowIds`). These make the durable txn↔recurring
   * link QUERYABLE (`array-contains`) so recurring reconciliation can find a
   * bill/income's payments without the stale Plaid stream `transactionIds[]`.
   */
  split_outflow_ids: string[];
  split_inflow_ids: string[];
}

/**
 * Merge `result` onto `resolved.raw_splits`. PURE — `now` is injected so the
 * caller controls the timestamp (and tests stay deterministic).
 */
export function merge_assignment_onto_raw_splits(
  resolved: ResolvedAssignment,
  result: TransactionAssignmentResult,
  now: Timestamp
): MergedAssignment {
  const by_id = new Map(result.splits.map((s) => [s.split_id, s]));
  let name_changed = false;
  /* eslint-disable @typescript-eslint/naming-convention */
  const updated_splits = resolved.raw_splits.map((raw) => {
    const a = by_id.get(raw.splitId as string);
    if (!a) {
      return raw;
    }
    // Denormalized budget NAME per lens (from the id→name map) so the app can
    // show each period view's budget without a lookup. Legacy `budgetName` tracks
    // the monthly lens (budgetId = monthly alias).
    const monthly_name = resolved.budget_names[a.monthly_budget_id];
    const weekly_name = resolved.budget_names[a.weekly_budget_id];
    const bi_weekly_name = resolved.budget_names[a.bi_weekly_budget_id];
    const budget_name = monthly_name;
    if (
      (monthly_name !== undefined && raw.budgetName !== monthly_name) ||
      (weekly_name !== undefined && raw.weeklyBudgetName !== weekly_name) ||
      (bi_weekly_name !== undefined && raw.biWeeklyBudgetName !== bi_weekly_name)
    ) {
      name_changed = true;
    }
    return {
      ...raw,
      // Legacy alias (= monthly lens) kept until all readers use the lens fields.
      budgetId: a.budget_id,
      budgetName: budget_name ?? raw.budgetName,
      budgetAssignmentSource: a.budget_assignment_source,
      // Per-lens assignment (Per-Period-Everything-Else): the split is placed
      // independently in each period cadence. All three share the same source.
      monthlyBudgetId: a.monthly_budget_id,
      weeklyBudgetId: a.weekly_budget_id,
      biWeeklyBudgetId: a.bi_weekly_budget_id,
      monthlyBudgetName: monthly_name ?? (raw.monthlyBudgetName ?? null),
      weeklyBudgetName: weekly_name ?? (raw.weeklyBudgetName ?? null),
      biWeeklyBudgetName: bi_weekly_name ?? (raw.biWeeklyBudgetName ?? null),
      monthlyBudgetSource: a.budget_assignment_source,
      weeklyBudgetSource: a.budget_assignment_source,
      biWeeklyBudgetSource: a.budget_assignment_source,
      outflowId: a.outflow_id,
      inflowId: a.inflow_id,
      monthlyPeriodId: a.monthly_period_id,
      weeklyPeriodId: a.weekly_period_id,
      biWeeklyPeriodId: a.bi_weekly_period_id,
      // App-category classification (Simplified-Transaction-Categories): the
      // user-facing slugs + source. 'user' source preserves a manual override;
      // secondCategoryId holds the specific chosen category only on an override.
      overallCategoryId: a.overall_category_id,
      firstCategoryId: a.first_category_id,
      secondCategoryId: a.second_category_id,
      categorySource: a.category_source,
      updatedAt: now,
    };
  });
  /* eslint-enable @typescript-eslint/naming-convention */

  // splitBudgetIds = the distinct budgets a split touches ACROSS all three lenses
  // (scopes the recompute fan-out in process_transaction_written).
  const split_budget_ids = [
    ...new Set(
      result.splits.flatMap((s) => [
        s.monthly_budget_id,
        s.weekly_budget_id,
        s.bi_weekly_budget_id,
      ])
    ),
  ];

  // Distinct recurring links across the splits → queryable denorm arrays.
  const split_outflow_ids = [
    ...new Set(
      result.splits
        .map((s) => s.outflow_id)
        .filter((id): id is string => !!id)
    ),
  ];
  const split_inflow_ids = [
    ...new Set(
      result.splits
        .map((s) => s.inflow_id)
        .filter((id): id is string => !!id)
    ),
  ];

  return {
    updated_splits,
    name_changed,
    split_budget_ids,
    split_outflow_ids,
    split_inflow_ids,
  };
}
