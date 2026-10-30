/**
 * D1 matching of payments to converted bills (Convert-To-Recurring Phase 2) — PURE.
 *
 * A converted record is a v2 + manual record with a stored vendor key on a Plaid account
 * (`is_converted_candidate`). A payment links to it when it is the same direction + account +
 * vendor, whatever its amount (D1 / D39) — a deterministic key, not the fuzzy scorer. The key maps
 * to a LIST of bills (D44: two bills from one vendor on one account are allowed):
 *
 *   - one eligible bill  → it (final, no fuzzy fallthrough);
 *   - two or more        → the fuzzy scorer restricted to exactly those bills; if it decides, that
 *                          one, else the closest expected amount, then the smallest id — a pure
 *                          function of stored data (never "closest to today").
 *
 * What D1 links (the narrow rule the review settled on):
 *   - only SINGLE-split transactions (a multi-split payment is the user's own breakdown; the source
 *     split of a convert is pinned directly and a pin always wins);
 *   - only payments on or after the record's D1 floor — the day it was created by the new path
 *     (`d1_from_ms`), never before its first date minus the early-payment pad. The payments a
 *     convert linked in the past (D2 / D46: one per occurrence) are listed on the record
 *     (`retro_plaid_ids`) and stay linked; the rest of the vendor's past payments stay in budgets.
 *
 * @module domain/recurring/converted_match
 */
import { ConvertDirection } from "./convert_recurring.service";
/** One converted bill, as the matcher needs it. */
export interface ConvertedBillForMatch {
    id: string;
    /** Payments created in our database on/after this instant may be older than `d1_from_ms` (pending
     *  that posted, history that synced late) — they link when dated after the bill's first date (A). */
    created_from_ms: number;
    /** The earliest date a late-arriving payment may carry (first date − the early pad). */
    first_floor_ms: number;
    /** The bill's expected amount (override, else average) — only to break a tie between bills. */
    amount: number;
    /** D1 links payments dated on or after this (UTC ms). */
    d1_from_ms: number;
    /** Past payments (Plaid transaction ids) a convert linked — allowed before `d1_from_ms`. */
    retro_plaid_ids: ReadonlySet<string>;
}
/** The loaded record fields the index is built from (a bill / income entity fits). */
export interface ConvertedRecordInput {
    id: string;
    direction: ConvertDirection;
    is_active: boolean;
    is_hidden: boolean;
    merged_into_id?: string | null;
    capture_rules_version?: number | null;
    source?: string | null;
    vendor_key?: string | null;
    account_id?: string | null;
    average_amount: number;
    expected_amount_override?: number | null;
    first_date_ms: number;
    converted_at_ms?: number | null;
    retro_txn_ids?: string[] | null;
}
export interface ConvertedIndex {
    /** `direction|account|vendor` → its bills, sorted by id. */
    by_key: Map<string, ConvertedBillForMatch[]>;
    /** id → bill (the absorbed-id hit looks its floors up here). */
    by_id: Map<string, ConvertedBillForMatch>;
    /** Exactly the ids in `by_key` — fuzzy matching excludes these (a bill with no account / vendor
     *  key is not in the map and stays in fuzzy). */
    ids: Set<string>;
}
/** Build the index from the user's loaded bills + income. Active, shown, un-merged records only. PURE. */
export declare function build_converted_index(records: ConvertedRecordInput[]): ConvertedIndex;
/** May D1 link this payment to this bill (date floor, or a payment a convert linked)? PURE. */
export declare function d1_allows(bill: ConvertedBillForMatch, payment: {
    date_ms: number;
    plaid_id: string | null;
    created_ms?: number | null;
}): boolean;
/**
 * The bills a payment is eligible for: a payment a convert LINKED (its retro list) belongs to that
 * bill alone — another bill of the same key never competes for it (so the trigger path and the
 * batch path, whatever candidates each loaded, give the same answer).
 */
export declare function eligible_bills(bills: ConvertedBillForMatch[], payment: {
    date_ms: number;
    plaid_id: string | null;
    created_ms?: number | null;
}): ConvertedBillForMatch[];
/**
 * Choose among the bills D1 allows. `scorer_pick` is the fuzzy scorer's decision restricted to
 * exactly these bills (null when it didn't decide). PURE and deterministic.
 */
export declare function pick_converted_bill(eligible: ConvertedBillForMatch[], split_amount: number, scorer_pick: string | null): string | null;
//# sourceMappingURL=converted_match.service.d.ts.map