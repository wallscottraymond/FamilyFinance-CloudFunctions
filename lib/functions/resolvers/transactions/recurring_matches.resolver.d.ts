/**
 * Recurring Matches Resolver
 *
 * READ-ONLY: for a transaction, find which of its splits match a recurring bill
 * (outflow) — producing the `outflow_id` the assignment engine puts on the
 * split. Loads candidate outflow periods in a window around the transaction
 * date and runs the pure `match_recurring` scorer per split.
 *
 * Inflow (income) matching is deferred to Recurring-Period-Reconciliation (the
 * inflow-period reconciliation is new); `inflow_id` stays null for now.
 *
 * Composite index: `outflow_periods(userId ASC, expectedDueDate ASC)`.
 *
 * @module resolvers/transactions/recurring_matches
 */
import { TraceContext } from "../../types";
/** Per-split recurring links keyed by split id (the engine's `recurring_by_split`). */
export type RecurringBySplit = Record<string, {
    outflow_id: string | null;
    inflow_id: string | null;
}>;
/**
 * Resolve the recurring (bill) matches for a transaction's splits.
 *
 * @param splits - The splits (split_id + amount) to match
 * @param txn_type - Transaction type; only `expense` matches outflows
 */
export declare function resolve_recurring_matches(ctx: TraceContext, user_id: string, txn_type: string, txn_merchant_name: string | null, txn_date_ms: number, splits: Array<{
    split_id: string;
    amount: number;
}>): Promise<RecurringBySplit>;
//# sourceMappingURL=recurring_matches.resolver.d.ts.map