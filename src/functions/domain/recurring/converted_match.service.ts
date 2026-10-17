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

import { D1_EARLY_PAD_MS, ConvertDirection, converted_key, is_converted_candidate } from "./convert_recurring.service";

/** One converted bill, as the matcher needs it. */
export interface ConvertedBillForMatch {
  id: string;
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
  /** Exactly the ids in `by_key` — fuzzy matching excludes these (a bill with no account / vendor
   *  key is not in the map and stays in fuzzy). */
  ids: Set<string>;
}

/** Build the index from the user's loaded bills + income. Active, shown, un-merged records only. PURE. */
export function build_converted_index(records: ConvertedRecordInput[]): ConvertedIndex {
  const by_key = new Map<string, ConvertedBillForMatch[]>();
  const ids = new Set<string>();
  for (const r of records) {
    if (!r.is_active || r.is_hidden || r.merged_into_id) continue;
    if (!is_converted_candidate(r)) continue;
    const key = converted_key(r.direction, r.account_id as string, r.vendor_key as string);
    const floor = Math.max(r.first_date_ms - D1_EARLY_PAD_MS, r.converted_at_ms ?? Number.NEGATIVE_INFINITY);
    const bill: ConvertedBillForMatch = {
      id: r.id,
      amount: Math.abs(r.expected_amount_override ?? r.average_amount),
      d1_from_ms: floor,
      retro_plaid_ids: new Set(r.retro_txn_ids ?? []),
    };
    const list = by_key.get(key) ?? [];
    list.push(bill);
    by_key.set(key, list);
    ids.add(r.id);
  }
  for (const list of by_key.values()) list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { by_key, ids };
}

/** May D1 link this payment to this bill (date floor, or a payment a convert linked)? PURE. */
export function d1_allows(bill: ConvertedBillForMatch, payment: { date_ms: number; plaid_id: string | null }): boolean {
  return payment.date_ms >= bill.d1_from_ms || (!!payment.plaid_id && bill.retro_plaid_ids.has(payment.plaid_id));
}

/**
 * Choose among the bills D1 allows. `scorer_pick` is the fuzzy scorer's decision restricted to
 * exactly these bills (null when it didn't decide). PURE and deterministic.
 */
export function pick_converted_bill(
  eligible: ConvertedBillForMatch[],
  split_amount: number,
  scorer_pick: string | null
): string | null {
  if (eligible.length === 0) return null;
  if (eligible.length === 1) return eligible[0].id;
  if (scorer_pick && eligible.some((b) => b.id === scorer_pick)) return scorer_pick;
  const amount = Math.abs(split_amount);
  let best = eligible[0];
  for (const b of eligible) {
    const d = Math.abs(b.amount - amount);
    const bd = Math.abs(best.amount - amount);
    if (d < bd || (d === bd && b.id < best.id)) best = b;
  }
  return best.id;
}
