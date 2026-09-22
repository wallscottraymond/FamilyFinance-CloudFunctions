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
import { RecurringCandidate } from "../../domain/transactions/match_recurring.service";
/** Per-split recurring links keyed by split id (the engine's `recurring_by_split`). */
export type RecurringBySplit = Record<string, {
    outflow_id: string | null;
    inflow_id: string | null;
}>;
/**
 * Bill + income candidate periods loaded ONCE for a whole assign-batch (covering
 * [window_start_ms, window_end_ms]) instead of per transaction. `resolve_recurring_matches`
 * filters these to each transaction's ±90d window in memory, so the matched result is
 * IDENTICAL to loading per-transaction — this only removes the repeated
 * `outflow_periods`/`inflow_periods` reads (the top Firestore read line).
 */
export interface PreloadedRecurringCandidates {
    outflow_candidates: RecurringCandidate[];
    inflow_candidates: RecurringCandidate[];
    window_start_ms: number;
    window_end_ms: number;
}
/**
 * Load ALL bill + income candidate periods due in [start_ms, end_ms] ONCE (for the batch path).
 * These are the same two queries the per-transaction path runs — executed a single time.
 */
export declare function load_recurring_candidates(ctx: TraceContext, user_id: string, start_ms: number, end_ms: number): Promise<PreloadedRecurringCandidates>;
/**
 * Resolve the recurring (bill/income) matches for a transaction's splits.
 *
 * @param txn_type - Transaction type: `expense` → outflows, `income` → inflows.
 */
export declare function resolve_recurring_matches(ctx: TraceContext, user_id: string, txn_type: string, txn_merchant_name: string | null, txn_date_ms: number, splits: Array<{
    split_id: string;
    amount: number;
}>, opts?: {
    /** The transaction's Plaid id — matched against the recurring streams' `transactionIds`. */
    txn_plaid_id?: string | null;
    outflow_tx_to_id?: Map<string, string>;
    inflow_tx_to_id?: Map<string, string>;
    /** Batch-preloaded candidate periods (loaded once per batch) — avoids the per-txn query. */
    preloaded_candidates?: PreloadedRecurringCandidates;
}): Promise<RecurringBySplit>;
//# sourceMappingURL=recurring_matches.resolver.d.ts.map