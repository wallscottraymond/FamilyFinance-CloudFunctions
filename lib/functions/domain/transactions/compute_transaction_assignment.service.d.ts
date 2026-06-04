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
import { BudgetForMatch } from "./match_budget.service";
import { CategoryRule } from "./match_category.service";
import { SourcePeriodForMatch } from "./match_source_periods.service";
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
export declare function compute_transaction_assignment(splits: SplitForAssignment[], context: AssignmentContext): TransactionAssignmentResult;
//# sourceMappingURL=compute_transaction_assignment.service.d.ts.map