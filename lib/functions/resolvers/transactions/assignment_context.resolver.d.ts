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
 * Resolve the assignment context for a transaction.
 *
 * @returns The resolved context, or null if the transaction is missing/inactive.
 */
export declare function resolve_assignment_context(ctx: TraceContext, user_id: string, transaction_id: string): Promise<ResolvedAssignment | null>;
//# sourceMappingURL=assignment_context.resolver.d.ts.map