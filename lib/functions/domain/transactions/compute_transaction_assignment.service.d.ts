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
import { BudgetForMatch, PeriodLens } from "./match_budget.service";
/** The three period lenses, in a stable order. */
export declare const PERIOD_LENSES: PeriodLens[];
import { CategoryRule } from "./match_category.service";
import { SourcePeriodForMatch } from "./match_source_periods.service";
/** A split as it currently stands, with the fields the engine reads + owns. */
export interface SplitForAssignment {
    split_id: string;
    /** The manual-pin signal: when `budget_assignment_source === "manual"`, this is
     *  the globally-pinned budget id. Also the legacy single-budget field. */
    budget_id: string;
    budget_assignment_source: "category" | "manual";
    /** Prior per-lens assignments (for touched-set + skip-if-unchanged). Fall back
     *  to `budget_id` (monthly) for pre-migration docs that lack them. */
    monthly_budget_id?: string;
    weekly_budget_id?: string;
    bi_weekly_budget_id?: string;
    internal_match_category: string | null;
    plaid_match_category: string;
    outflow_id: string | null;
    inflow_id: string | null;
    monthly_period_id: string | null;
    weekly_period_id: string | null;
    bi_weekly_period_id: string | null;
    /** Prior app-category classification (for override-preservation + skip-if-unchanged).
     *  Optional: pre-migration splits lack them; `category_source` defaults to "plaid". */
    overall_category_id?: string | null;
    first_category_id?: string | null;
    /** SECONDARY-level override: the chosen category doc id (== Plaid detailed). Only
     *  meaningful when `category_source === "user"`; null = a first-only override. */
    second_category_id?: string | null;
    category_source?: "plaid" | "user";
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
    /** True for income transactions. Income NEVER auto-assigns to a budget (B1) —
     *  it stays unassigned unless the user manually pins it. */
    txn_is_income: boolean;
    /** All real budgets across every cadence; the engine filters per lens. */
    real_budgets: BudgetForMatch[];
    /** The Everything Else budget id PER LENS (null for a lens with no EE budget). */
    everything_else_budget_ids: Record<PeriodLens, string | null>;
    category_rules: CategoryRule[];
    /** plaidDetailed → the two app-category slugs, from the `categories` collection.
     *  Missing key → the split gets null slugs (unmapped Plaid detailed). */
    category_slugs_by_plaid: Record<string, {
        overall_category_id: string | null;
        first_category_id: string | null;
    }>;
    source_periods: SourcePeriodForMatch[];
    /** Recurring match per split id (empty = no recurring match). */
    recurring_by_split: Record<string, RecurringMatch>;
}
/** The computed assignment for one split (the engine-owned fields only). */
export interface AssignedSplit {
    split_id: string;
    /** Per-lens budget assignment — the split is placed INDEPENDENTLY per cadence. */
    monthly_budget_id: string;
    weekly_budget_id: string;
    bi_weekly_budget_id: string;
    /** All three share the same source (global manual pin, else category). */
    budget_assignment_source: "category" | "manual";
    /** LEGACY alias = monthly_budget_id (kept until callers read the lens fields). */
    budget_id: string;
    outflow_id: string | null;
    inflow_id: string | null;
    monthly_period_id: string | null;
    weekly_period_id: string | null;
    bi_weekly_period_id: string | null;
    /** App-category classification (Simplified-Transaction-Categories): the two
     *  user-facing slugs + their source. `"user"` = a preserved manual override. */
    overall_category_id: string | null;
    first_category_id: string | null;
    /** The chosen SECONDARY category doc id — only set on a user override (else null). */
    second_category_id: string | null;
    category_source: "plaid" | "user";
    /** Why this assignment was made — for per-split decision logging (monthly lens). */
    reason: {
        budget: "category+date" | "everything_else_fallback" | "no_everything_else" | "manual" | "income_excluded";
        tie: boolean;
        recurring: "outflow" | "inflow" | "manual_detached" | "none";
    };
}
/** Result of assembling a transaction's assignment. */
export interface TransactionAssignmentResult {
    splits: AssignedSplit[];
    /** Budgets whose contribution may have changed (old ∪ new) — fan-out scope. */
    touched_budget_ids: string[];
    /** Recurring outflow docs whose period status may have changed (old ∪ new). */
    touched_outflow_ids: string[];
    /** Recurring inflow docs whose period status may have changed (old ∪ new). */
    touched_inflow_ids: string[];
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