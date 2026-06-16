/**
 * Recurring Matches Resolver
 *
 * READ-ONLY: for a transaction, find which of its splits match a recurring bill
 * (outflow) or recurring income (inflow) — producing the `outflow_id` / `inflow_id`
 * the assignment engine puts on the split. Loads candidate periods in a window
 * around the transaction date and runs the pure `match_recurring` scorer per split.
 *
 * - `expense` transactions → outflow (bill) candidates → `outflow_id`
 * - `income` transactions  → inflow (income) candidates → `inflow_id`
 * - `transfer` → neither.
 *
 * Composite indexes: `outflow_periods(userId, firstDueDateInPeriod)`,
 * `inflow_periods(userId, firstDueDateInPeriod)`.
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
 * Resolve the recurring (bill/income) matches for a transaction's splits.
 *
 * @param txn_type - Transaction type: `expense` → outflows, `income` → inflows.
 */
export declare function resolve_recurring_matches(ctx: TraceContext, user_id: string, txn_type: string, txn_merchant_name: string | null, txn_date_ms: number, splits: Array<{
    split_id: string;
    amount: number;
}>): Promise<RecurringBySplit>;
//# sourceMappingURL=recurring_matches.resolver.d.ts.map