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
import { FeeKind } from "../../domain/budgets/spend_breakdown.service";
import { InternalTransferResult } from "../../domain/transactions/internal_transfer.service";
import { CategoryCatalog, ResolvedSplitCategory } from "../../domain/transactions/split_category.service";
/** Transaction-level context a split inherits (computed once per transaction). */
export interface TxnMatchContext {
    txn_date_ms: number;
    is_pending: boolean;
    /** INTERNAL (matched-pair own-account) transfer — NOT the blanket category. */
    is_transfer: boolean;
    /** Both sides of this card payment are in the view (`detect_card_payment_pairs_from_txns`).
     *  Optional; defaults false. */
    is_paired_card_payment?: boolean;
    /** The clock, for the wait on a card side (`CARD_SIDE_WAIT_MS`). Omitted = no wait. */
    now_ms?: number;
    /** Transaction `type === "income"` (a credit). */
    is_income: boolean;
    /** Txn belongs to a recurring bill/income Plaid stream (by `transactionIds`) — even if
     *  the split's `outflowId`/`inflowId` link is unset. Excludes it from budget spend (S5).
     *  Optional; callers without stream context omit it (defaults false). */
    is_recurring_member?: boolean;
    /** For the category function's merchant / keyword rules. */
    merchant_name?: string | null;
    name?: string | null;
    /** The transaction's stored `vendorKey` (spend breakdown only); absent → computed from the
     *  names by the same `vendor_key` function that stores it. */
    vendor_key?: string | null;
}
/** How long a paying side waits for its card side before counting as spending (D8): the pairing
 *  tolerance, so a payment that could still pair never counts first. */
export declare const CARD_SIDE_WAIT_MS: number;
/**
 * Whether a card-payment split is money movement rather than spending (Trustworthy-Numbers D1):
 * the card-side credit always is, so a payment can never reduce spending; the paying side is only
 * when the card's side is in the view too, or may still be on its way. Otherwise the payment is the
 * only record of that spending here, so it counts. PURE.
 */
export declare function card_payment_is_money_movement(semantic_code: string, ctx: {
    is_income: boolean;
    is_paired_card_payment?: boolean;
    txn_date_ms?: number;
    now_ms?: number;
}, 
/** The user chose this split's category: only a card-payment pick means a card payment. */
is_user_pick?: boolean): boolean;
/**
 * Map a raw Firestore split (+ its transaction context) into the on-read matcher's
 * shape. The single source of truth for how a split's spendStatus, categories, and
 * manual pin are read.
 */
export declare function map_raw_split_to_on_read_match(raw_split: Record<string, unknown>, ctx: TxnMatchContext, catalog: CategoryCatalog): SplitForOnReadMatch;
/**
 * The spend-breakdown fields of a split ("Easy to change" tips; never a counting decision): the
 * transaction's vendor key — its stored `vendorKey`, else the same `vendor_key` function vendor
 * history stores — a display name (merchant name, else the transaction name), and its bank-fee
 * kind. From the already-loaded transaction: no reads. PURE.
 */
export declare function split_breakdown_fields(txn: {
    merchant_name?: unknown;
    name?: unknown;
    vendor_key?: unknown;
}, category: ResolvedSplitCategory, plaid_detailed: string | null): {
    vendor_key: string | null;
    place_name: string | null;
    fee_kind: FeeKind | null;
};
/**
 * The category MEANING (a Plaid code) of a transaction for transfer pairing, from the ONE
 * category function (a user pick away from a transfer category makes that split spending): the
 * first split that is still a TRANSFER, else the first split. Order-independent — a transaction
 * with any transfer split pairs, whichever split comes first.
 */
export declare function txn_effective_category(data: Record<string, unknown>, catalog: CategoryCatalog): string;
/**
 * The card payments whose two sides are both in `txns`: the same matched-pair rule as transfers
 * (opposite direction, same amount, different account, a few days apart; canon A7). Kept apart
 * from `internal_ids` on purpose: a stream with an internal transfer gets hidden as a bill, and a
 * card payment the user tracks as a bill must stay one. Decided regardless of a side's status, so
 * ignoring one side changes nothing. PURE.
 */
export declare function detect_card_payment_pairs_from_txns(txns: Array<{
    id: string;
    data: Record<string, unknown>;
}>, catalog: CategoryCatalog): Set<string>;
/**
 * Detect INTERNAL (own-account matched-pair) transfers over a set of already-loaded
 * transactions. Builds the pure matcher's input from the raw docs, then runs
 * `detect_internal_transfers`. Returns internal doc-ids + Plaid-ids.
 */
export declare function detect_internal_transfers_from_txns(txns: Array<{
    id: string;
    data: Record<string, unknown>;
}>, catalog: CategoryCatalog): InternalTransferResult;
//# sourceMappingURL=on_read_matching.d.ts.map