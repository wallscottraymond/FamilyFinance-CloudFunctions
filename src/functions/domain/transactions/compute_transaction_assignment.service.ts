/**
 * Compute Transaction Assignment Domain Service
 *
 * The PURE heart of the Transaction Assignment Engine: given a transaction's
 * splits + the resolved context, sequence the matchers through the precedence
 * and return the new per-split assignment, the set of budgets touched
 * (before ∪ after — for the scoped fan-out), and whether anything changed
 * (for skip-if-unchanged).
 *
 * Precedence per split:  category → manual? → recurring → budget → source periods
 *
 * The recurring matchers (outflow/inflow) are owned by Recurring-Period-
 * Reconciliation; their per-split result is INJECTED via the context, so this
 * service stays pure and complete without them.
 *
 * NO async, NO IO, NO side effects.
 *
 * @module domain/transactions/compute_transaction_assignment
 */

import {
  match_budget,
  BudgetForMatch,
  UNASSIGNED_BUDGET_ID,
} from "./match_budget.service";
import { match_category, CategoryRule } from "./match_category.service";
import {
  match_source_periods,
  SourcePeriodForMatch,
} from "./match_source_periods.service";

/** A split as it currently stands, with the fields the engine reads + owns. */
export interface SplitForAssignment {
  split_id: string;
  budget_id: string;
  budget_assignment_source: "category" | "manual";
  internal_match_category: string | null;
  plaid_match_category: string;
  outflow_id: string | null;
  inflow_id: string | null;
  monthly_period_id: string | null;
  weekly_period_id: string | null;
  bi_weekly_period_id: string | null;
}

/** Recurring match result for one split (produced by the recurring matchers). */
export interface RecurringMatch {
  outflow_id: string | null;
  inflow_id: string | null;
}

/** Everything the assembler needs, resolved once per transaction. */
export interface AssignmentContext {
  txn_date_ms: number;
  txn_merchant_name: string | null;
  txn_name: string | null;
  real_budgets: BudgetForMatch[];
  everything_else_budget_id: string | null;
  category_rules: CategoryRule[];
  source_periods: SourcePeriodForMatch[];
  /** Recurring match per split id (empty = no recurring match). */
  recurring_by_split: Record<string, RecurringMatch>;
}

/** The computed assignment for one split (the engine-owned fields only). */
export interface AssignedSplit {
  split_id: string;
  budget_id: string;
  budget_assignment_source: "category" | "manual";
  outflow_id: string | null;
  inflow_id: string | null;
  monthly_period_id: string | null;
  weekly_period_id: string | null;
  bi_weekly_period_id: string | null;
  /** Why this assignment was made — for per-split decision logging. */
  reason: {
    budget: "category+date" | "everything_else_fallback" | "no_everything_else" | "manual";
    tie: boolean;
    recurring: "outflow" | "inflow" | "manual_detached" | "none";
  };
}

/** Result of assembling a transaction's assignment. */
export interface TransactionAssignmentResult {
  splits: AssignedSplit[];
  /** Budgets whose contribution may have changed (old ∪ new) — fan-out scope. */
  touched_budget_ids: string[];
  /** False → no engine-owned field changed (skip the write). */
  changed: boolean;
  /** True → a split has no Everything Else budget to fall to (missing-EE ERROR). */
  any_unassigned: boolean;
}

/**
 * Assemble the assignment for all of a transaction's splits.
 *
 * PURE FUNCTION.
 */
export function compute_transaction_assignment(
  splits: SplitForAssignment[],
  context: AssignmentContext
): TransactionAssignmentResult {
  // Source periods are transaction-level (one date) → compute once.
  const periods = match_source_periods(context.txn_date_ms, context.source_periods);

  const assigned: AssignedSplit[] = [];
  const touched = new Set<string>();
  let changed = false;
  let any_unassigned = false;

  for (const split of splits) {
    touched.add(split.budget_id); // before

    let budget_id: string;
    let source: "category" | "manual";
    let outflow_id: string | null;
    let inflow_id: string | null;
    let budget_reason: AssignedSplit["reason"]["budget"];
    let tie = false;
    let recurring_reason: AssignedSplit["reason"]["recurring"];

    // A manual pin is only honored while its budget still EXISTS. If the pinned
    // budget was deleted, the pin is stale → fall through to category matching
    // so the split re-homes (otherwise a "forced" split survives the delete).
    const pin_budget_valid =
      split.budget_id === context.everything_else_budget_id ||
      context.real_budgets.some((b) => b.id === split.budget_id);

    if (split.budget_assignment_source === "manual" && pin_budget_valid) {
      // Manual pin is authoritative: keep the budget, DETACH recurring.
      source = "manual";
      budget_id = split.budget_id;
      outflow_id = null;
      inflow_id = null;
      budget_reason = "manual";
      recurring_reason = "manual_detached";
    } else {
      source = "category";

      // 1. Resolve the effective category (may upgrade OTHER_EXPENSE).
      const resolved_plaid = match_category(
        {
          plaid_match_category: split.plaid_match_category,
          merchant_name: context.txn_merchant_name,
          name: context.txn_name,
        },
        context.category_rules
      ).category;

      // 2. Recurring (injected from the recurring matchers).
      const recurring = context.recurring_by_split[split.split_id] ?? {
        outflow_id: null,
        inflow_id: null,
      };
      outflow_id = recurring.outflow_id;
      inflow_id = recurring.inflow_id;
      recurring_reason = outflow_id ? "outflow" : inflow_id ? "inflow" : "none";

      // 3. Budget (real budgets, else Everything Else structural fallback).
      const budget = match_budget(
        {
          internal_match_category: split.internal_match_category,
          plaid_match_category: resolved_plaid,
        },
        context.txn_date_ms,
        context.real_budgets,
        context.everything_else_budget_id
      );
      budget_id = budget.budget_id;
      budget_reason = budget.reason;
      tie = budget.tie;
    }

    if (budget_id === UNASSIGNED_BUDGET_ID) {
      any_unassigned = true;
    }
    touched.add(budget_id); // after

    const next: AssignedSplit = {
      split_id: split.split_id,
      budget_id,
      budget_assignment_source: source,
      outflow_id,
      inflow_id,
      monthly_period_id: periods.monthly_period_id,
      weekly_period_id: periods.weekly_period_id,
      bi_weekly_period_id: periods.bi_weekly_period_id,
      reason: { budget: budget_reason, tie, recurring: recurring_reason },
    };
    assigned.push(next);

    if (split_assignment_changed(split, next)) {
      changed = true;
    }
  }

  return {
    splits: assigned,
    touched_budget_ids: [...touched],
    changed,
    any_unassigned,
  };
}

/** Whether any engine-owned field differs between the stored split and the new one. PURE. */
function split_assignment_changed(
  before: SplitForAssignment,
  after: AssignedSplit
): boolean {
  return (
    before.budget_id !== after.budget_id ||
    before.budget_assignment_source !== after.budget_assignment_source ||
    before.outflow_id !== after.outflow_id ||
    before.inflow_id !== after.inflow_id ||
    before.monthly_period_id !== after.monthly_period_id ||
    before.weekly_period_id !== after.weekly_period_id ||
    before.bi_weekly_period_id !== after.bi_weekly_period_id
  );
}
