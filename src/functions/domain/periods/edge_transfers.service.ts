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

import { CARD_PAYMENT_CATEGORY } from "../transactions/category_semantics.service";

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

/** Effective category of a transaction: its first split's override, else Plaid's. */
function effective_category(data: Record<string, unknown>): string {
  const first = ((data.splits as Array<Record<string, unknown>>) ?? [])[0] ?? {};
  return (
    (first.internalDetailedCategory as string | null) ??
    (first.plaidDetailedCategory as string | null) ??
    ""
  );
}

/**
 * The view's transactions that are internal across ALL the members' accounts
 * (`all_members`) but NOT internal inside the view (`view_internal_ids`).
 *
 * Callers pair in two stages: `all_members` should be the pairing of every member
 * transaction EXCEPT the view's own internal pairs, so pairs inside the view always
 * win and a cross-view match can't steal them.
 */
export function find_crossing_transfers(
  all_members: PairingResult,
  view_internal_ids: Set<string>,
  view_txns: Array<{ id: string; data: Record<string, unknown> }>
): CrossingTransfers {
  const out: CrossingTransfers = {
    ids: new Set(),
    in_ids: new Set(),
    out_ids: new Set(),
    plaid_ids: new Set(),
  };
  for (const { id, data } of view_txns) {
    if (!all_members.internal_ids.has(id) || view_internal_ids.has(id)) continue;
    out.ids.add(id);
    const cat = effective_category(data);
    // Card payments share one category on both legs; the transaction type says which way.
    const is_in =
      cat === CARD_PAYMENT_CATEGORY ? data.type === "income" : cat.startsWith("TRANSFER_IN");
    if (is_in) out.in_ids.add(id);
    else out.out_ids.add(id);
    const plaid_id = (data.transactionId as string | null) ?? null;
    if (plaid_id) out.plaid_ids.add(plaid_id);
  }
  return out;
}
