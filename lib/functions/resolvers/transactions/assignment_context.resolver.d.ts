/**
 * Assignment Context Resolver
 *
 * READ-ONLY: loads everything the Transaction Assignment Engine needs to assign
 * one transaction's splits — the transaction, the user's real budgets (+ the
 * Everything Else id), the source periods overlapping the date, and the category
 * rules — and maps them to the pure core's input types.
 *
 * Recurring matches are NOT resolved here yet (owned by Recurring-Period-
 * Reconciliation); `recurring_by_split` is left empty until that ships.
 *
 * @module resolvers/transactions/assignment_context
 */
import { TraceContext } from "../../types";
import { BudgetForMatch } from "../../domain/transactions/match_budget.service";
import { CategoryRule } from "../../domain/transactions/match_category.service";
import { SplitForAssignment, AssignmentContext } from "../../domain/transactions/compute_transaction_assignment.service";
/** What the orchestrator needs back: the raw splits (for read-modify-write) + the pure input. */
export interface ResolvedAssignment {
    transaction_doc_id: string;
    /** Raw camelCase split maps, preserved so the write merges onto them. */
    raw_splits: Array<Record<string, unknown>>;
    splits_input: SplitForAssignment[];
    context: AssignmentContext;
    /** budget_id → name, so the engine can denormalize `budgetName` onto splits. */
    budget_names: Record<string, string>;
}
/**
 * The transaction-INDEPENDENT slice of the assignment context: a user's real
 * budgets, the Everything Else fallback id, budget id→name, and the category
 * rules. These depend only on `user_id`, so when assigning many of a user's
 * transactions they can be resolved ONCE and reused — avoiding the per-transaction
 * re-read of budgets and the categories collection (the main read amplification).
 */
export interface SharedAssignmentContext {
    real_budgets: BudgetForMatch[];
    budget_names: Record<string, string>;
    everything_else_budget_id: string | null;
    category_rules: CategoryRule[];
}
/**
 * Resolve the transaction-independent shared context for a user (budgets +
 * categories). Loaded once per batch; pass into `resolve_assignment_context` to
 * skip the per-transaction re-reads.
 */
export declare function resolve_shared_assignment_context(ctx: TraceContext, user_id: string): Promise<SharedAssignmentContext>;
/**
 * Resolve the assignment context for a transaction.
 *
 * @param shared - Optional pre-resolved shared context (budgets + categories).
 *   When provided (batch path), the per-transaction budget/category reads are
 *   skipped; only the transaction doc, its overlapping source periods, and its
 *   recurring matches are read.
 * @returns The resolved context, or null if the transaction is missing/inactive.
 */
export declare function resolve_assignment_context(ctx: TraceContext, user_id: string, transaction_id: string, shared?: SharedAssignmentContext): Promise<ResolvedAssignment | null>;
//# sourceMappingURL=assignment_context.resolver.d.ts.map