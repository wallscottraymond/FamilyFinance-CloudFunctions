/**
 * Edge Transfers (Account-Rooted-Sharing D12; Rules §5.2–5.3)
 *
 * A transfer between two of the members' own accounts is internal when both
 * accounts are in the same view (it counts 0 there). When it CROSSES the view
 * boundary — one side in the view, the matching side in another view — the side
 * inside the view counts at the edge: money in = income for the view, money out
 * = spending. Pairing across all members' accounts finds those crossings; with
 * nothing shared, every pair is inside the view and nothing is crossing.
 *
 * PURE: no IO.
 *
 * @module domain/periods/edge_transfers
 */
/** What a pairing pass returns (see internal_transfer.service). */
export interface PairingResult {
    internal_ids: Set<string>;
    internal_plaid_ids: Set<string>;
}
export interface CrossingTransfers {
    /** View transactions that cross the boundary (doc ids). */
    ids: Set<string>;
    /** …of which money came INTO the view. */
    in_ids: Set<string>;
    /** …of which money went OUT of the view. */
    out_ids: Set<string>;
    /** Plaid ids of the crossing transactions (to match recurring streams). */
    plaid_ids: Set<string>;
}
/**
 * THE pairing slack every transfer pairer uses on each side of the window it counts: a transfer
 * leg posted a few days outside (an ACH landing on the 2nd for a debit on the 31st) still pairs.
 * Everyone who pairs live (the period page, a budget's transaction list, on-read / stored spend)
 * and the stored transfer roles pair over [window − this, window + this] and COUNT only the
 * window — so they decide the same pairs (canon A14).
 */
export declare const TRANSFER_PAIRING_BUFFER_MS: number;
/**
 * The view's transactions that are internal across ALL the members' accounts
 * (`all_members`) but NOT internal inside the view (`view_internal_ids`).
 *
 * Callers pair in two stages: `all_members` should be the pairing of every member
 * transaction EXCEPT the view's own internal pairs, so pairs inside the view always
 * win and a cross-view match can't steal them.
 */
export declare function find_crossing_transfers(all_members: PairingResult, view_internal_ids: Set<string>, view_txns: Array<{
    id: string;
    data: Record<string, unknown>;
}>, 
/** The category meaning (a Plaid code) — callers pass the ONE category function's. */
category_of?: (data: Record<string, unknown>) => string): CrossingTransfers;
//# sourceMappingURL=edge_transfers.service.d.ts.map