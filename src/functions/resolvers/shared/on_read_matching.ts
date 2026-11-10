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

import { Timestamp } from "firebase-admin/firestore";
import { SplitForOnReadMatch } from "../../domain/budgets/budget_spend_match.service";
import { split_spend_status } from "../../domain/budgets/budget_spend.service";
import { FeeKind, split_fee_kind } from "../../domain/budgets/spend_breakdown.service";
import { clean_vendor_name, vendor_key } from "../../domain/transactions/vendor_key.service";
import {
  detect_internal_transfers,
  InternalTransferResult,
  TransferForPairing,
} from "../../domain/transactions/internal_transfer.service";
import {
  is_card_payment_category,
  is_income_category,
  is_transfer_category,
} from "../../domain/transactions/category_semantics.service";
import {
  resolve_split_category,
  CategoryCatalog,
  ResolvedSplitCategory,
} from "../../domain/transactions/split_category.service";
import { split_category_input_from_raw } from "../../domain/transactions/split_category_edit.service";

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
export const CARD_SIDE_WAIT_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * Whether a card-payment split is money movement rather than spending (Trustworthy-Numbers D1):
 * the card-side credit always is, so a payment can never reduce spending; the paying side is only
 * when the card's side is in the view too, or may still be on its way. Otherwise the payment is the
 * only record of that spending here, so it counts. PURE.
 */
export function card_payment_is_money_movement(
  semantic_code: string,
  ctx: { is_income: boolean; is_paired_card_payment?: boolean; txn_date_ms?: number; now_ms?: number },
  /** The user chose this split's category: only a card-payment pick means a card payment. */
  is_user_pick = false
): boolean {
  // A credit paired as a card side, whatever its code (D7: Chase labels its side differently).
  if (ctx.is_paired_card_payment && ctx.is_income && !is_user_pick) return true;
  if (!is_card_payment_category(semantic_code)) return false;
  if (ctx.is_income || ctx.is_paired_card_payment === true) return true;
  // D8: the card side usually arrives in 1–3 days. Until then a big payment must not swing Spent.
  if (ctx.now_ms === undefined || ctx.txn_date_ms === undefined) return false;
  const age_ms = ctx.now_ms - ctx.txn_date_ms;
  return age_ms >= 0 && age_ms < CARD_SIDE_WAIT_MS;
}

/**
 * Map a raw Firestore split (+ its transaction context) into the on-read matcher's
 * shape. The single source of truth for how a split's spendStatus, categories, and
 * manual pin are read.
 */
export function map_raw_split_to_on_read_match(
  raw_split: Record<string, unknown>,
  ctx: TxnMatchContext,
  catalog: CategoryCatalog
): SplitForOnReadMatch {
  // The ONE category function (canon M7) via THE raw-split mapper — the same calls the assignment
  // engine makes, so the period page and the stored fields can't disagree.
  const category_input = split_category_input_from_raw(
    raw_split,
    { merchantName: ctx.merchant_name ?? null, name: ctx.name ?? null },
    catalog
  );
  const category = resolve_split_category(category_input, catalog);
  return {
    amount: (raw_split.amount as number) ?? 0,
    txn_date_ms: ctx.txn_date_ms,
    is_pending: ctx.is_pending,
    // The transaction's internal-transfer flag applies to a split only while ITS category is a
    // transfer (a split the user re-categorized to spending counts as spending — as the engine
    // decides per split).
    // Same per-split rule for a card payment (`card_payment_is_money_movement`).
    is_transfer:
      (ctx.is_transfer && is_transfer_category(category.semantic_code)) ||
      card_payment_is_money_movement(category.semantic_code, ctx, category.category_source === "user"),
    is_income: ctx.is_income,
    spend_status: split_spend_status(raw_split),
    outflow_id: (raw_split.outflowId as string | null) ?? null,
    inflow_id: (raw_split.inflowId as string | null) ?? null,
    is_recurring_member: ctx.is_recurring_member ?? false,
    first_category_id: category.first_category_id,
    semantic_code: category.semantic_code,
    manual_pin_budget_id:
      (raw_split.budgetAssignmentSource as string) === "manual"
        ? (raw_split.budgetId as string) ?? null
        : null,
    ...split_breakdown_fields(
      { merchant_name: ctx.merchant_name, name: ctx.name, vendor_key: ctx.vendor_key },
      category,
      category_input.plaid_detailed
    ),
  };
}

/**
 * The spend-breakdown fields of a split ("Easy to change" tips; never a counting decision): the
 * transaction's vendor key — its stored `vendorKey`, else the same `vendor_key` function vendor
 * history stores — a display name (merchant name, else the transaction name), and its bank-fee
 * kind. From the already-loaded transaction: no reads. PURE.
 */
export function split_breakdown_fields(
  txn: { merchant_name?: unknown; name?: unknown; vendor_key?: unknown },
  category: ResolvedSplitCategory,
  plaid_detailed: string | null
): { vendor_key: string | null; place_name: string | null; fee_kind: FeeKind | null } {
  const merchant_name = typeof txn.merchant_name === "string" ? txn.merchant_name : null;
  const name = typeof txn.name === "string" ? txn.name : null;
  const stored = typeof txn.vendor_key === "string" && txn.vendor_key ? txn.vendor_key : null;
  const place_source = [merchant_name, name]
    .map((v) => (v ?? "").trim())
    .find((v) => v.length > 0);
  return {
    vendor_key: stored ?? vendor_key({ merchant_name, name }),
    place_name: place_source ? clean_vendor_name(place_source) : null,
    fee_kind: split_fee_kind(category, plaid_detailed),
  };
}

/**
 * The category MEANING (a Plaid code) of a transaction for transfer pairing, from the ONE
 * category function (a user pick away from a transfer category makes that split spending): the
 * first split that is still a TRANSFER, else the first split. Order-independent — a transaction
 * with any transfer split pairs, whichever split comes first.
 */
export function txn_effective_category(
  data: Record<string, unknown>,
  catalog: CategoryCatalog
): string {
  const splits = (data.splits as Array<Record<string, unknown>>) ?? [];
  const codes = (splits.length ? splits : [{}]).map(
    (s) => resolve_split_category(split_category_input_from_raw(s, data, catalog), catalog)
      .semantic_code
  );
  return codes.find((c) => is_transfer_category(c)) ?? codes[0];
}

/**
 * The card payments whose two sides are both in `txns`: the same matched-pair rule as transfers
 * (opposite direction, same amount, different account, a few days apart; canon A7). Kept apart
 * from `internal_ids` on purpose: a stream with an internal transfer gets hidden as a bill, and a
 * card payment the user tracks as a bill must stay one. Decided regardless of a side's status, so
 * ignoring one side changes nothing. PURE.
 */
export function detect_card_payment_pairs_from_txns(
  txns: Array<{ id: string; data: Record<string, unknown> }>,
  catalog: CategoryCatalog
): Set<string> {
  const payments: TransferForPairing[] = [];
  const look_alike_credits: TransferForPairing[] = [];
  for (const { id, data } of txns) {
    const raw = (data.splits as Array<Record<string, unknown>>) ?? [];
    const is_card_payment = (raw.length ? raw : [{}]).some((s) =>
      is_card_payment_category(
        resolve_split_category(split_category_input_from_raw(s, data, catalog), catalog).semantic_code
      )
    );
    const entry: TransferForPairing = {
      id,
      plaid_id: (data.transactionId as string | null) ?? null,
      account_id: (data.accountId as string) ?? "",
      amount: raw.reduce((s, sp) => s + Math.abs((sp.amount as number) ?? 0), 0),
      date_ms: (data.transactionDate as Timestamp).toMillis(),
      direction: data.type === "income" ? "in" : "out",
    };
    if (is_card_payment) {
      payments.push(entry);
    } else if (data.type === "income" && can_be_card_side(raw, data, catalog)) {
      look_alike_credits.push(entry);
    }
  }
  if (payments.length === 0) return new Set();
  const paired = detect_internal_transfers(payments).internal_ids;
  // D7: some banks label the card side differently (Chase: LOAN_DISBURSEMENTS_*). Debits a real
  // card side didn't take may pair with a same-amount credit on another account.
  const leftover = payments.filter((p) => p.direction === "out" && !paired.has(p.id));
  if (leftover.length && look_alike_credits.length) {
    for (const id of detect_internal_transfers([...leftover, ...look_alike_credits]).internal_ids) {
      paired.add(id);
    }
  }
  return paired;
}

/** Could this credit be a card side labeled differently? Never money that already means something
 *  else (a transfer, income, a linked bill or income line) or a category the user chose. */
function can_be_card_side(
  raw: Array<Record<string, unknown>>,
  data: Record<string, unknown>,
  catalog: CategoryCatalog
): boolean {
  return raw.length > 0 && raw.every((s) => {
    if (s.categorySource === "user" || s.budgetAssignmentSource === "manual") return false;
    if (s.inflowId || s.outflowId) return false; // already tracked as income or a bill
    const code = resolve_split_category(split_category_input_from_raw(s, data, catalog), catalog).semantic_code;
    return !is_transfer_category(code) && !is_income_category(code);
  });
}

/**
 * Detect INTERNAL (own-account matched-pair) transfers over a set of already-loaded
 * transactions. Builds the pure matcher's input from the raw docs, then runs
 * `detect_internal_transfers`. Returns internal doc-ids + Plaid-ids.
 */
export function detect_internal_transfers_from_txns(
  txns: Array<{ id: string; data: Record<string, unknown> }>,
  catalog: CategoryCatalog
): InternalTransferResult {
  const transfers: TransferForPairing[] = [];
  for (const { id, data } of txns) {
    const eff = txn_effective_category(data, catalog);
    if (!is_transfer_category(eff)) continue;
    const raw = (data.splits as Array<Record<string, unknown>>) ?? [];
    transfers.push({
      id,
      plaid_id: (data.transactionId as string | null) ?? null,
      account_id: (data.accountId as string) ?? "",
      amount: raw.reduce((s, sp) => s + Math.abs((sp.amount as number) ?? 0), 0),
      date_ms: (data.transactionDate as Timestamp).toMillis(),
      direction: eff.startsWith("TRANSFER_IN") ? "in" : "out",
    });
  }
  return detect_internal_transfers(transfers);
}
