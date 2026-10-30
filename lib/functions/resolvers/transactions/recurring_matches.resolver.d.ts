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
import { ConvertedIndex } from "../../domain/recurring/converted_match.service";
/** Per-split recurring links keyed by split id (the engine's `recurring_by_split`). */
export type RecurringBySplit = Record<string, {
    outflow_id: string | null;
    inflow_id: string | null;
    /** A stream-member payment that ALSO has an eligible converted bill of its D1 key: used by the
     *  caller only when the stream's bill is dropped as another view's (D1 fallthrough). */
    d1_alt_id?: string | null;
    d1_alt_kind?: "outflow" | "inflow";
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
 * Load candidate periods SCOPED to a known set of outflow/inflow ids (read-cost #1). Same shape
 * as `load_recurring_candidates`, but instead of scanning ALL of a user's due periods it reads
 * only the given streams' periods in [start_ms, end_ms]. Correct for the recurring-reconcile
 * assign path: its txns ARE these streams' membership, so single-split txns resolve via the
 * authoritative stream map and multi-split scoring only ever needs its own stream's occurrences.
 * `window_start/end` stay the true batch span so `candidates_for_txn`'s coverage check passes
 * (never falling back to a per-txn full scan).
 */
export declare function load_recurring_candidates_scoped(ctx: TraceContext, outflow_ids: string[], inflow_ids: string[], start_ms: number, end_ms: number): Promise<PreloadedRecurringCandidates>;
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
    /** Plaid ids held out of the FUZZY scorer (X3) — stream membership above still applies. */
    fuzzy_excluded_plaid_ids?: Set<string>;
    /** v2 record id → its account: fuzzy-linked only from that account (F13). */
    v2_account_by_recurring_id?: Map<string, string>;
    /** The transaction's (Plaid) account id. */
    txn_account_id?: string | null;
    /** Converted bills / income by D1 key (Convert-To-Recurring Phase 2). */
    converted_index?: ConvertedIndex;
    /** The transaction's vendor key (stored, else computed the same way). */
    txn_vendor_key?: string | null;
    /** When our copy of the transaction was created (a late arrival links, A). */
    txn_created_ms?: number | null;
    /** Plaid payment id → the converted bill that ABSORBED it (D42). Subject to the same floors and
     *  the single-split rule as a D1 key hit (B). */
    absorbed_tx_to_id?: Map<string, string>;
}): Promise<RecurringBySplit>;
//# sourceMappingURL=recurring_matches.resolver.d.ts.map