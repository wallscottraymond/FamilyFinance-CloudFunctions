/**
 * Shared on-read matching helpers.
 *
 * ONE place that maps raw Firestore transaction/split data into the domain shapes
 * the on-read spend/matching path consumes — so every path (period derivation,
 * budget-view spend, budget-detail transactions, materialized recompute) reads a
 * split the same way and applies the SAME transfer rule. Previously this ~30-line
 * mapping and the matched-pair setup were copy-pasted across several resolvers,
 * which let them drift (notably: matched-pair vs blanket transfer detection).
 *
 * PURE: no IO. Callers load the transactions; these map the already-loaded data.
 *
 * @module resolvers/shared/on_read_matching
 */
import { SplitForOnReadMatch } from "../../domain/budgets/budget_spend_match.service";
import { InternalTransferResult } from "../../domain/transactions/internal_transfer.service";
/** Transaction-level context a split inherits (computed once per transaction). */
export interface TxnMatchContext {
    txn_date_ms: number;
    is_pending: boolean;
    /** INTERNAL (matched-pair own-account) transfer — NOT the blanket category. */
    is_transfer: boolean;
    /** Transaction `type === "income"` (a credit). */
    is_income: boolean;
    /** Txn belongs to a recurring bill/income Plaid stream (by `transactionIds`) — even if
     *  the split's `outflowId`/`inflowId` link is unset. Excludes it from budget spend (S5).
     *  Optional; callers without stream context omit it (defaults false). */
    is_recurring_member?: boolean;
}
/**
 * Map a raw Firestore split (+ its transaction context) into the on-read matcher's
 * shape. The single source of truth for how a split's spendStatus, categories, and
 * manual pin are read.
 */
export declare function map_raw_split_to_on_read_match(raw_split: Record<string, unknown>, ctx: TxnMatchContext): SplitForOnReadMatch;
/** The effective (internal-override-aware) category of a transaction's first split. */
export declare function txn_effective_category(data: Record<string, unknown>): string;
/**
 * Detect INTERNAL (own-account matched-pair) transfers over a set of already-loaded
 * transactions. Builds the pure matcher's input from the raw docs, then runs
 * `detect_internal_transfers`. Returns internal doc-ids + Plaid-ids.
 */
export declare function detect_internal_transfers_from_txns(txns: Array<{
    id: string;
    data: Record<string, unknown>;
}>): InternalTransferResult;
//# sourceMappingURL=on_read_matching.d.ts.map