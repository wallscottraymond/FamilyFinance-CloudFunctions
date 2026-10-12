/**
 * Budget Spend Resolver
 *
 * READ-ONLY: gather the transaction splits assigned to a budget within a period's
 * date range, mapped to the spend domain's input. Uses a `transactionDate` range
 * query (top-level, indexable) + an in-memory filter on `split.budgetId` — the
 * splits-read constraint (splits are an array of maps and can't be queried by an
 * inner field). Bounded to one period's transactions.
 *
 * Composite index required: `transactions(userId ASC, transactionDate ASC)`.
 *
 * @module resolvers/budgets/budget_spend
 */

import { TRANSFER_PAIRING_BUFFER_MS } from "../../domain/periods/edge_transfers.service";
import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { transaction_repo } from "../../repositories/transaction.repo";
import {
  SplitForSpend,
  is_income_category,
} from "../../domain/budgets/budget_spend.service";
import {
  detect_internal_transfers_from_txns,
  txn_effective_category,
} from "../shared/on_read_matching";
import { is_transfer_category } from "../../domain/transactions/category_semantics.service";
import { load_category_catalog } from "../shared/category_catalog.resolver";
import { resolve_split_category } from "../../domain/transactions/split_category.service";
import { split_category_input_from_raw } from "../../domain/transactions/split_category_edit.service";
import { PeriodInstanceType } from "../../domain/budgets";

/** Active transactions in a window (what `transaction_repo.get_active_in_date_range` returns). */
export type WindowTxns = Awaited<ReturnType<typeof transaction_repo.get_active_in_date_range>>;

/**
 * Per-call memo of window transaction loads. A single recompute touches several budgets whose
 * periods share IDENTICAL date windows (every budget's monthly period is the same month), so
 * each window is read once instead of once per budget. Exact-window keyed → identical results.
 */
export function create_window_txn_loader(
  ctx: TraceContext,
  user_id: string
): (start_ms: number, end_ms: number) => Promise<WindowTxns> {
  const memo = new Map<string, Promise<WindowTxns>>();
  return (start_ms, end_ms) => {
    const key = `${start_ms}:${end_ms}`;
    let p = memo.get(key);
    if (!p) {
      p = transaction_repo.get_active_in_date_range(ctx, user_id, start_ms, end_ms);
      memo.set(key, p);
    }
    return p;
  };
}

/** Which split field carries the budget assignment for each period lens. */
const LENS_FIELD: Record<PeriodInstanceType, string> = {
  monthly: "monthlyBudgetId",
  weekly: "weeklyBudgetId",
  bi_monthly: "biWeeklyBudgetId",
};

/**
 * Resolve the spend splits for a (budget, period date range).
 *
 * Per-Period-EE: a split is assigned INDEPENDENTLY per lens, so we match the split
 * field for THIS budget's cadence (`cadence` = the budget's own `period`, applied
 * to all its periods — prime and non-prime). Pre-migration docs only have the
 * legacy `budgetId` (= the monthly assignment), so the monthly lens falls back to
 * it; weekly/bi_monthly match only their own field.
 *
 * @returns Every countable-candidate split assigned to `budget_id` in the range.
 */
export async function resolve_spend_splits(
  ctx: TraceContext,
  user_id: string,
  budget_id: string,
  start_ms: number,
  end_ms: number,
  cadence: PeriodInstanceType = "monthly",
  load_txns?: (start_ms: number, end_ms: number) => Promise<WindowTxns>
): Promise<SplitForSpend[]> {
  const load = (lo: number, hi: number) =>
    load_txns ? load_txns(lo, hi) : transaction_repo.get_active_in_date_range(ctx, user_id, lo, hi);
  const txns = await load(start_ms, end_ms);

  // Internal transfers are excluded as on the period page: the stored matched-pair role when the
  // classifier has decided it (it decides per VIEW — an edge_out contribution counts), else live
  // pairing over the period ± the shared slack (as the page pairs). The wider read happens only
  // when a transfer hasn't been classified yet (rare: the classifier runs right after a sync).
  const catalog = await load_category_catalog(ctx);
  const needs_live = txns.some(
    (t) =>
      t.data.transferRole === undefined &&
      is_transfer_category(txn_effective_category(t.data, catalog))
  );
  const pool = needs_live
    ? await load(start_ms - TRANSFER_PAIRING_BUFFER_MS, end_ms + TRANSFER_PAIRING_BUFFER_MS)
    : txns;
  const { internal_ids } = detect_internal_transfers_from_txns(pool, catalog);

  const out: SplitForSpend[] = [];
  for (const { id, data: d } of txns) {
    const txn_date_ms = (d.transactionDate as Timestamp).toMillis();
    const is_pending = d.isPending === true;
    const role = d.transferRole as string | undefined;
    const txn_is_internal_transfer =
      role !== undefined ? role === "internal" : internal_ids.has(id);
    const txn_is_income = d.type === "income";
    const splits = (d.splits as Array<Record<string, unknown>>) ?? [];
    for (const s of splits) {
      const spend = stored_split_for_spend(s, d, budget_id, cadence, catalog, {
        txn_date_ms,
        is_pending,
        is_transfer: txn_is_internal_transfer,
        is_income: txn_is_income,
      });
      if (spend) out.push(spend);
    }
  }
  return out;
}

/**
 * One STORED split → the spend domain's input for `budget_id` in `cadence`'s lens, or null when
 * the split isn't stored in that budget. PURE — the stored half of "stored == derived" (the
 * property test runs it against the engine and the period page).
 */
export function stored_split_for_spend(
  s: Record<string, unknown>,
  txn: Record<string, unknown>,
  budget_id: string,
  cadence: PeriodInstanceType,
  catalog: Awaited<ReturnType<typeof load_category_catalog>>,
  t: { txn_date_ms: number; is_pending: boolean; is_transfer: boolean; is_income: boolean }
): SplitForSpend | null {
  // The split's assignment in this budget's lens; monthly falls back to the legacy `budgetId`
  // for pre-migration docs.
  let assigned = s[LENS_FIELD[cadence]] as string | undefined;
  if (assigned === undefined && cadence === "monthly") {
    assigned = s.budgetId as string | undefined;
  }
  if (assigned !== budget_id) return null;
  // The category's meaning from the ONE category function (a user pick away from income makes
  // it spending).
  const effective_category = resolve_split_category(
    split_category_input_from_raw(s, txn, catalog),
    catalog
  ).semantic_code;
  // A manual pin counts in its budget whatever the money is (canon A4) — as on the page. The
  // engine stores a pin per lens (an Everything Else pin → each lens's own EE), so the pin is
  // "here" when this lens's stored budget is this budget.
  const pinned = s.budgetAssignmentSource === "manual";
  return {
    budget_id,
    amount: (s.amount as number) ?? 0,
    txn_date_ms: t.txn_date_ms,
    is_pending: t.is_pending,
    is_transfer: !pinned && t.is_transfer,
    is_income: t.is_income,
    is_income_category: !pinned && is_income_category(effective_category),
    // Derive on read (no migration): explicit spendStatus wins, else fall back to the legacy
    // isIgnored/isRefund booleans, else 'counted'.
    spend_status:
      (s.spendStatus as "counted" | "ignored" | "refund" | undefined) ??
      (s.isIgnored === true ? "ignored" : s.isRefund === true ? "refund" : "counted"),
    outflow_id: (s.outflowId as string | null) ?? null,
    inflow_id: (s.inflowId as string | null) ?? null,
  };
}
