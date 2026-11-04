/**
 * Derive Budget Transactions (orchestrator)
 *
 * READ-ONLY (Derive-On-Read): the transactions a budget owns FOR A PERIOD,
 * resolved ON READ (category + manual pin + Everything-Else fallback) — not from a
 * stored `budgetId`. Each owned split is tagged with a DERIVED display status:
 *   - counted  → contributes to Spent
 *   - ignored  → excluded from Spent but VISIBLE + user-manageable. Reasons:
 *       transfer (internal account transfer, matched-pair), income (real INCOME_*),
 *       manual (user set spendStatus='ignored')
 *   - refund   → money back (spendStatus='refund')
 * Recurring-linked splits (outflow/inflow) are omitted — they're tracked as bills/income.
 *
 * This lets the budget-detail screen show ignored items (incl. auto-ignored
 * transfers) in a dedicated section, with the pill to include them if desired.
 *
 * @module orchestrators/budgets/derive_budget_transactions
 */

import { TraceContext } from "../../types";
import { fire_and_forget } from "../../observability";
import {
  resolve_view_version,
  view_key_for,
} from "../../resolvers/periods/view_version.resolver";
import {
  get_cached_result,
  put_cached_result,
  DERIVED_CACHE_TTL_MS,
  utc_day_key,
} from "../../repositories/derived_result_cache.repo";
import { DeriveScopeRequest } from "../../domain/periods/derive_scope.service";
import {
  load_period_derivation_raw,
  shape_period_derivation_deps,
} from "../../resolvers/periods/period_derivation.resolver";
import { owned_splits_for_budget, resolve_split_owner } from "../../domain/budgets/budget_spend_match.service";
import { is_within_budget_range } from "../../domain/transactions/match_budget.service";
import { is_paused_on } from "../../domain/budgets/budget_pause.service";
import { is_income_category, is_transfer_category } from "../../domain/transactions/category_semantics.service";
import { PeriodInstanceType } from "../../domain/budgets";
import {
  CardTransaction,
  to_card_transaction,
} from "../../domain/transactions/transaction_card.service";

/** L2 cache collection for this callable ([[Firestore-Read-Cost-Reduction]] B′). */
const BUDGET_TXN_CACHE = "derived_budget_txn_cache";
/** Result SHAPE version, part of the cache key: bump whenever the row shape changes so a cached
 *  result in the old shape (24h TTL) is never served. v2 = rows carry `card`. v3 = one counting
 *  decision with the period page, card payments are money movement (Trustworthy-Numbers). v4 = D7, D8. */
const BUDGET_TXN_CACHE_SHAPE = "v4";

export type DerivedSpendStatus = "counted" | "ignored" | "refund";
export type IgnoredReason = "transfer" | "income" | "manual" | null;

export interface DerivedBudgetTransaction {
  transaction_id: string;
  split_id: string | null;
  date_ms: number;
  name: string;
  amount: number; // the owned split's amount (absolute)
  is_pending: boolean;
  spend_status: DerivedSpendStatus;
  ignored_reason: IgnoredReason;
  /** The whole transaction, for the app's shared transaction row (one per split row; the app
   *  groups a transaction's rows into one tile). */
  card: CardTransaction;
}

/**
 * The view a period window belongs to, from its length: weekly is up to 7 days, bi-monthly up to
 * 16, otherwise monthly. Pairing depends on the view's span, so Detail must shape as that view for
 * its list to equal that view's card. Needs no new input, so older app builds get it too. PURE.
 */
export function view_cadence_of_window(start_ms: number, end_ms: number): PeriodInstanceType {
  const days = Math.ceil((end_ms - start_ms) / (24 * 60 * 60 * 1000));
  if (days <= 7) return "weekly";
  return days <= 16 ? "bi_monthly" : "monthly";
}

export async function derive_budget_transactions_orchestrator(
  ctx: TraceContext,
  user_id: string,
  budget_id: string,
  start_ms: number,
  end_ms: number,
  force = false,
  scope_request?: DeriveScopeRequest
): Promise<DerivedBudgetTransaction[]> {
  // 0. Cache key + version per VIEW (Account-Rooted-Sharing): Me exactly as before; a group =
  //    "group:<id>" with a members-aware version (membership checked even on a cache hit).
  const view_key = view_key_for(user_id, scope_request);

  // L2 CACHE: serve the version-matched result (2 reads) instead of the ~348-doc window read
  // + derivation. Correctness = version match (bumped on every budget/txn write); the cache
  // stamp uses the version read BEFORE compute so a mid-compute bump forces the next miss.
  const cache_id = `${view_key}__${budget_id}__${start_ms}__${end_ms}__${BUDGET_TXN_CACHE_SHAPE}__${utc_day_key()}`;
  let data_version: number;
  if (force) {
    data_version = (await resolve_view_version(ctx, user_id, scope_request)).version;
  } else {
    const [vv, cached] = await Promise.all([
      resolve_view_version(ctx, user_id, scope_request),
      get_cached_result<DerivedBudgetTransaction[]>(BUDGET_TXN_CACHE, cache_id),
    ]);
    data_version = vv.version;
    if (
      cached &&
      cached.data_version === data_version &&
      Date.now() - cached.computed_at_ms < DERIVED_CACHE_TTL_MS
    ) {
      return cached.result;
    }
  }

  // ONE counting decision (Trustworthy-Numbers AF-07): the same load and shape as the period page,
  // so this list can't disagree with the card, the charts or the widgets about which transactions
  // count. Everything the page decides per split comes from here: the view, transfer and card
  // payment pairing, edge money, released payments of a removed bill, bill and income streams.
  const cadence = view_cadence_of_window(start_ms, end_ms);
  const raw_load = await load_period_derivation_raw(
    ctx,
    user_id,
    cadence,
    [{ start_ms, end_ms }],
    scope_request,
    { counting_only: true }
  );
  const deps = shape_period_derivation_deps(raw_load, cadence, start_ms, end_ms);
  const target_is_ee = raw_load.budget_entities.some(
    (b) => b.id === budget_id && b.is_system_everything_else
  );
  const ee_id = target_is_ee ? budget_id : deps.any_ee_id;
  const txn_by_id = new Map(raw_load.txns.map((t) => [t.id, t.data]));

  const out: DerivedBudgetTransaction[] = [];
  for (const match of deps.splits_for_match) {
    if (match.txn_date_ms < start_ms || match.txn_date_ms > end_ms) continue;
    const [owned] = owned_splits_for_budget(
      budget_id,
      deps.real_budgets,
      ee_id,
      [match],
      deps.ee_alias_ids
    );
    if (!owned) continue;
    // Bill and income money is tracked there, not as a budget line. A stream member the user
    // ignored stays visible here (uncounted): no bill shows it.
    if (owned.outflow_id || owned.inflow_id) continue;
    if (owned.is_recurring_member && match.spend_status !== "ignored") continue;
    const id = match.source_txn_id as string;
    const data = txn_by_id.get(id) as Record<string, unknown>;

    // Display status: why it doesn't count (transfer / income / the user's ignore), else the
    // stored status.
    let spend_status: DerivedSpendStatus = match.spend_status;
    let ignored_reason: IgnoredReason = null;
    if (owned.is_transfer || owned.is_transfer_category) {
      spend_status = "ignored";
      ignored_reason = "transfer";
    } else if (owned.is_income_category) {
      spend_status = "ignored";
      ignored_reason = "income";
    } else if (match.spend_status === "ignored") {
      ignored_reason = "manual";
    }

    out.push({
      transaction_id: id,
      split_id: match.source_split_id ?? null,
      date_ms: match.txn_date_ms,
      name: (data.merchantName as string) || (data.name as string) || (data.description as string) || "Transaction",
      amount: Math.abs(match.amount),
      is_pending: match.is_pending,
      spend_status,
      ignored_reason,
      card: to_card_transaction(id, data),
    });
  }

  // Newest first.
  out.sort((a, b) => b.date_ms - a.date_ms);

  // Cache the result stamped with the pre-compute version (fire-and-forget; skips if a heavy
  // budget's list exceeds the size guard, in which case that call just stays uncached).
  fire_and_forget(() => put_cached_result(BUDGET_TXN_CACHE, cache_id, data_version, out));
  return out;
}

export interface AddableTransaction {
  transaction_id: string;
  split_id: string;
  date_ms: number;
  name: string;
  amount: number;
  /** Where it counts now, so moving it is never silent. */
  current_budget_name: string;
}

/**
 * What can be added to a budget by hand in a window (Manual-Budgets): the view's own money-out splits
 * a pin would actually land on. Decided by the same load and shape as the page, so the list holds
 * nothing the engine would drop: only the budget's own view, only dates inside its range and not
 * paused, only the caller's own transactions, and never a bill or income payment, a transfer, or
 * income. READ-ONLY.
 */
export async function derive_addable_transactions_orchestrator(
  ctx: TraceContext,
  user_id: string,
  budget_id: string,
  start_ms: number,
  end_ms: number,
  scope_request?: DeriveScopeRequest
): Promise<AddableTransaction[]> {
  const cadence = view_cadence_of_window(start_ms, end_ms);
  const raw_load = await load_period_derivation_raw(ctx, user_id, cadence, [{ start_ms, end_ms }], scope_request, {
    counting_only: true,
  });
  const deps = shape_period_derivation_deps(raw_load, cadence, start_ms, end_ms);
  const target = deps.real_budgets.find((b) => b.id === budget_id);
  if (!target) return [];
  const ee_id = deps.any_ee_id;
  const name_of = new Map(raw_load.budget_entities.map((b) => [b.id, b.name]));
  const txn_by_id = new Map(raw_load.txns.map((t) => [t.id, t.data]));
  const out: AddableTransaction[] = [];
  for (const m of deps.splits_for_match) {
    if (m.txn_date_ms < start_ms || m.txn_date_ms > end_ms) continue;
    if (!m.source_txn_id || !m.source_split_id || !is_within_budget_range(m.txn_date_ms, target)) continue;
    if (m.is_income || m.is_transfer || m.outflow_id || m.inflow_id || m.is_recurring_member) continue;
    // A paused day's spending stays in Everything Else, so a pin wouldn't land.
    if (is_paused_on(target.paused_ranges, m.txn_date_ms)) continue;
    if (is_transfer_category(m.semantic_code) || is_income_category(m.semantic_code)) continue;
    const owner = resolve_split_owner(m, deps.real_budgets, ee_id, deps.ee_alias_ids);
    if (owner === budget_id) continue;
    const data = txn_by_id.get(m.source_txn_id) as Record<string, unknown>;
    // Only a transaction's owner can edit it, so in a group each member adds their own.
    if (data.userId !== user_id) continue;
    out.push({
      transaction_id: m.source_txn_id,
      split_id: m.source_split_id,
      date_ms: m.txn_date_ms,
      name: (data.merchantName as string) || (data.name as string) || (data.description as string) || "Transaction",
      amount: Math.abs(m.amount),
      current_budget_name: name_of.get(owner) ?? "Everything Else",
    });
  }
  return out.sort((a, b) => b.date_ms - a.date_ms);
}
