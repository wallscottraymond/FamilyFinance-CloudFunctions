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
    const budget_name = resolved.budget_names[a.budget_id];
    if (budget_name !== undefined && raw.budgetName !== budget_name) {
      name_changed = true;
    }
    return {
      ...raw,
      budgetId: a.budget_id,
      budgetName: budget_name ?? raw.budgetName,
      budgetAssignmentSource: a.budget_assignment_source,
      outflowId: a.outflow_id,
      inflowId: a.inflow_id,
      monthlyPeriodId: a.monthly_period_id,
      weeklyPeriodId: a.weekly_period_id,
      biWeeklyPeriodId: a.bi_weekly_period_id,
      updatedAt: now,
    };
  });
  /* eslint-enable @typescript-eslint/naming-convention */

  const split_budget_ids = [...new Set(result.splits.map((s) => s.budget_id))];
  return { updated_splits, name_changed, split_budget_ids };
}
