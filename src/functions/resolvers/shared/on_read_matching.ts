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
import {
  detect_internal_transfers,
  InternalTransferResult,
  TransferForPairing,
} from "../../domain/transactions/internal_transfer.service";
import { is_transfer_category } from "../../domain/transactions/category_semantics.service";
import {
  resolve_split_category,
  CategoryCatalog,
} from "../../domain/transactions/split_category.service";
import { split_category_input_from_raw } from "../../domain/transactions/split_category_edit.service";

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
  /** For the category function's merchant / keyword rules. */
  merchant_name?: string | null;
  name?: string | null;
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
  // The ONE category function (canon M7) — the same call the assignment engine makes, so the
  // period page and the stored fields can't disagree. Legacy `internal*` fields are not read.
  const category = resolve_split_category(
    split_category_input_from_raw(
      raw_split,
      { merchantName: ctx.merchant_name ?? null, name: ctx.name ?? null },
      catalog
    ),
    catalog
  );
  return {
    amount: (raw_split.amount as number) ?? 0,
    txn_date_ms: ctx.txn_date_ms,
    is_pending: ctx.is_pending,
    is_transfer: ctx.is_transfer,
    is_income: ctx.is_income,
    spend_status:
      (raw_split.spendStatus as "counted" | "ignored" | "refund" | undefined) ??
      (raw_split.isIgnored === true
        ? "ignored"
        : raw_split.isRefund === true
          ? "refund"
          : "counted"),
    outflow_id: (raw_split.outflowId as string | null) ?? null,
    inflow_id: (raw_split.inflowId as string | null) ?? null,
    is_recurring_member: ctx.is_recurring_member ?? false,
    first_category_id: category.first_category_id,
    semantic_code: category.semantic_code,
    manual_pin_budget_id:
      (raw_split.budgetAssignmentSource as string) === "manual"
        ? (raw_split.budgetId as string) ?? null
        : null,
  };
}

/**
 * The category MEANING (a Plaid code) of a transaction's first split, from the ONE category
 * function: a user pick away from a transfer category makes it spending, not a transfer.
 */
export function txn_effective_category(
  data: Record<string, unknown>,
  catalog: CategoryCatalog
): string {
  const first = ((data.splits as Array<Record<string, unknown>>) ?? [])[0] ?? {};
  return resolve_split_category(split_category_input_from_raw(first, data, catalog), catalog)
    .semantic_code;
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
