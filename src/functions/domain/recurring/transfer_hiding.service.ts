/**
 * Transfer / card-payment hiding for recurring records (Convert-To-Recurring X7, gaps 3 + 5).
 *
 * OLD records (no v2 stamp) keep today's rule forever (D13): a transfer stream is hidden as soon as
 * ANY one of its transactions is an internal matched pair; card payments are never hidden.
 *
 * v2 records:
 *   - TRANSFER streams — the MAJORITY rule, counted only over the stream's transactions inside the
 *     classifier's loaded window (the stream's ids reach back 730 days, the pairing window is ~180;
 *     a 24-month stream with every in-window leg paired must hide):
 *       hide   when ≥ 2 in-window legs pair AND ≥ 50 % of the in-window legs pair;
 *       unhide only when < 25 % pair (HYSTERESIS: a borderline stream never flips as the window
 *       slides — each flip rewrites the record + its periods and forces an FE re-derive);
 *       no in-window legs → keep the current state.
 *   - a card-side "payment received" INFLOW (LOAN_PAYMENTS_CREDIT_CARD_PAYMENT) is ALWAYS hidden —
 *     at creation and here, so the self-correcting unhide never flips it back daily. The paying
 *     side (an outflow) is a real bill and stays.
 *
 * PURE: no IO.
 *
 * @module domain/recurring/transfer_hiding
 */

import { is_transfer_category } from "../transactions/category_semantics.service";
import { CARD_PAYMENT_CATEGORY } from "./capture_rules";

export const HIDE_RATIO = 0.5;
export const UNHIDE_RATIO = 0.25;
export const MIN_PAIRED = 2;

export interface HidingRecord {
  kind: "o" | "i";
  plaid_detailed_category: string;
  transaction_ids: string[] | undefined;
  is_hidden: boolean;
  v2: boolean;
}

/** Today's rule (old records): any one paired leg hides a transfer stream; card payments never. */
export function should_hide_v1(
  plaid_detailed_category: string,
  transaction_ids: string[] | undefined,
  internal_plaid_ids: Set<string>
): boolean {
  if (plaid_detailed_category === CARD_PAYMENT_CATEGORY) return false;
  if (!is_transfer_category(plaid_detailed_category)) return false;
  return (transaction_ids ?? []).some((t) => internal_plaid_ids.has(t));
}

/** The v2 rule (see the module doc). Returns the TARGET hidden state. */
export function should_hide_v2(
  r: HidingRecord,
  window_plaid_ids: Set<string>,
  internal_plaid_ids: Set<string>
): boolean {
  if (r.plaid_detailed_category === CARD_PAYMENT_CATEGORY) return r.kind === "i";
  if (!is_transfer_category(r.plaid_detailed_category)) return false;
  const in_window = (r.transaction_ids ?? []).filter((t) => window_plaid_ids.has(t));
  if (in_window.length === 0) return r.is_hidden;
  const paired = in_window.filter((t) => internal_plaid_ids.has(t)).length;
  const ratio = paired / in_window.length;
  if (r.is_hidden) return ratio >= UNHIDE_RATIO;
  return paired >= MIN_PAIRED && ratio >= HIDE_RATIO;
}

/** The target hidden state for any record: v1 for old records, v2 for stamped ones. */
export function target_hidden(
  r: HidingRecord,
  window_plaid_ids: Set<string>,
  internal_plaid_ids: Set<string>
): boolean {
  return r.v2
    ? should_hide_v2(r, window_plaid_ids, internal_plaid_ids)
    : should_hide_v1(r.plaid_detailed_category, r.transaction_ids, internal_plaid_ids);
}
