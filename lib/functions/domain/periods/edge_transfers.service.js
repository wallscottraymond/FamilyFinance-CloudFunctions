"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRANSFER_PAIRING_BUFFER_MS = void 0;
exports.find_crossing_transfers = find_crossing_transfers;
/** Default category meaning of a transaction: its first split's Plaid code. */
function plaid_category(data) {
    var _a, _b, _c;
    const first = (_b = ((_a = data.splits) !== null && _a !== void 0 ? _a : [])[0]) !== null && _b !== void 0 ? _b : {};
    return (_c = first.plaidDetailedCategory) !== null && _c !== void 0 ? _c : "";
}
/**
 * THE pairing slack every transfer pairer uses on each side of the window it counts: a transfer
 * leg posted a few days outside (an ACH landing on the 2nd for a debit on the 31st) still pairs.
 * Everyone who pairs live (the period page, a budget's transaction list, on-read / stored spend)
 * and the stored transfer roles pair over [window − this, window + this] and COUNT only the
 * window — so they decide the same pairs (canon A14).
 */
exports.TRANSFER_PAIRING_BUFFER_MS = 5 * 24 * 60 * 60 * 1000;
/**
 * The view's transactions that are internal across ALL the members' accounts
 * (`all_members`) but NOT internal inside the view (`view_internal_ids`).
 *
 * Callers pair in two stages: `all_members` should be the pairing of every member
 * transaction EXCEPT the view's own internal pairs, so pairs inside the view always
 * win and a cross-view match can't steal them.
 */
function find_crossing_transfers(all_members, view_internal_ids, view_txns, 
/** The category meaning (a Plaid code) — callers pass the ONE category function's. */
category_of = plaid_category) {
    var _a;
    const out = {
        ids: new Set(),
        in_ids: new Set(),
        out_ids: new Set(),
        plaid_ids: new Set(),
    };
    for (const { id, data } of view_txns) {
        if (!all_members.internal_ids.has(id) || view_internal_ids.has(id))
            continue;
        out.ids.add(id);
        if (category_of(data).startsWith("TRANSFER_IN"))
            out.in_ids.add(id);
        else
            out.out_ids.add(id);
        const plaid_id = (_a = data.transactionId) !== null && _a !== void 0 ? _a : null;
        if (plaid_id)
            out.plaid_ids.add(plaid_id);
    }
    return out;
}
//# sourceMappingURL=edge_transfers.service.js.map