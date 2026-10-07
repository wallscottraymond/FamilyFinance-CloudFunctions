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

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { fire_and_forget } from "../../observability";
import { budget_repo } from "../../repositories/budget.repo";
import { transaction_repo } from "../../repositories/transaction.repo";
import {
  resolve_view_version,
  view_key_for,
} from "../../resolvers/periods/view_version.resolver";
import {
  get_cached_result,
  put_cached_result,
  DERIVED_CACHE_TTL_MS,
} from "../../repositories/derived_result_cache.repo";
import { is_income_category } from "../../domain/budgets/budget_spend.service";
import {
  resolve_derive_scope,
  load_pairing_extra_txns,
} from "../../resolvers/periods/derive_scope.resolver";
import { find_crossing_transfers } from "../../domain/periods/edge_transfers.service";
import { outflow_repo } from "../../repositories/outflow.repo";
import { inflow_repo } from "../../repositories/inflow.repo";
import {
  DeriveScopeRequest,
  account_in_scope,
  transaction_in_scope,
} from "../../domain/periods/derive_scope.service";
import { resolve_split_owner } from "../../domain/budgets/budget_spend_match.service";
import { BudgetForMatch, PeriodLens } from "../../domain/transactions/match_budget.service";
import {
  detect_internal_transfers_from_txns,
  map_raw_split_to_on_read_match,
} from "../../resolvers/shared/on_read_matching";

// widen the window so cross-day transfer pairs match
const PAIRING_BUFFER_MS = 7 * 24 * 60 * 60 * 1000;

/** L2 cache collection for this callable ([[Firestore-Read-Cost-Reduction]] B′). */
const BUDGET_TXN_CACHE = "derived_budget_txn_cache";

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
}

function to_cadence(period: string): PeriodLens {
  return period === "weekly" ? "weekly" : period === "bi_monthly" ? "bi_monthly" : "monthly";
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
  const cache_id = `${view_key}__${budget_id}__${start_ms}__${end_ms}`;
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

  // The view's scope (only on a miss): Me minus the user's shared accounts, or the group.
  const scope = await resolve_derive_scope(ctx, user_id, scope_request);

  // 1. Budgets → real budgets (category ownership) + the EE id + is-target-EE.
  const budgets = await budget_repo.get_by_user_id(ctx, scope.budget_owner_key);
  const real_budgets: BudgetForMatch[] = [];
  let monthly_ee_id: string | null = null;
  let any_ee_id: string | null = null;
  let target_is_ee = false;
  for (const b of budgets) {
    if (b.is_system_everything_else) {
      any_ee_id = any_ee_id ?? b.id;
      if (b.period === "monthly") monthly_ee_id = b.id;
      if (b.id === budget_id) target_is_ee = true;
    } else {
      real_budgets.push({
        id: b.id,
        category_ids: b.category_ids,
        start_ms: b.start_date.toMillis(),
        end_ms: b.is_ongoing ? null : b.end_date.toMillis(),
        is_ongoing: b.is_ongoing,
        cadence: to_cadence(b.period),
      });
    }
  }
  const ee_id = target_is_ee ? budget_id : monthly_ee_id ?? any_ee_id;

  // 2. Load the window's transactions (+ a small buffer for transfer pairing). All members'
  //    transactions are kept server-side for cross-view pairing (D12); the view's are filtered.
  const all_member_txns = (
    await Promise.all(
      scope.member_ids.map((m) =>
        transaction_repo.get_active_in_date_range(
          ctx,
          m,
          start_ms - PAIRING_BUFFER_MS,
          end_ms + PAIRING_BUFFER_MS
        )
      )
    )
  ).flat();
  // The VIEW comes only from the members' own transactions…
  const txns = all_member_txns.filter((t) =>
    transaction_in_scope(
      scope,
      t.data.accountId as string | undefined,
      (t.data.transactionDate as Timestamp).toMillis()
    )
  );
  // …the pairing pool also covers known group accounts (D12; never counted, added AFTER the
  // view filter so they can't leak into it).
  all_member_txns.push(
    ...(await load_pairing_extra_txns(
      ctx,
      scope,
      start_ms - PAIRING_BUFFER_MS,
      end_ms + PAIRING_BUFFER_MS
    ))
  );

  // 2b. Live bills / income that live in ANOTHER view: a split linked to one of them is this
  //     view's ordinary money (same rule as the period page). Skipped entirely when nothing is
  //     shared, so Me with nothing shared does no extra reads.
  const scoped = scope.include_account_ids !== null || scope.exclude_account_ids.size > 0;
  const out_of_view_ids = new Set<string>();
  if (scoped) {
    const lists = await Promise.all(
      scope.member_ids.flatMap((m) => [
        outflow_repo.get_by_user_id(ctx, m),
        inflow_repo.get_by_user_id(ctx, m),
      ])
    );
    for (const r of lists.flat()) {
      if (r.is_active && !r.is_hidden && !account_in_scope(scope, r.account_id)) {
        out_of_view_ids.add(r.id);
      }
    }
  }

  // 3. Matched-pair internal-transfer detection over the buffered window, then (two-stage, as
  //    on the period page) the view's leftovers against the members' other accounts → edge money.
  const { internal_ids } = detect_internal_transfers_from_txns(txns);
  const crossing = find_crossing_transfers(
    detect_internal_transfers_from_txns(all_member_txns.filter((t) => !internal_ids.has(t.id))),
    internal_ids,
    txns
  );

  // 4. Resolve ownership on read; keep only splits owned by the target budget, in-window.
  const out: DerivedBudgetTransaction[] = [];
  for (const { id, data } of txns) {
    const date_ms = (data.transactionDate as Timestamp).toMillis();
    if (date_ms < start_ms || date_ms > end_ms) continue;
    const is_pending = data.isPending === true;
    const txn_is_internal_transfer = internal_ids.has(id);
    const raw = (data.splits as Array<Record<string, unknown>>) ?? [];
    const name =
      (data.merchantName as string) ||
      (data.name as string) ||
      (data.description as string) ||
      "Transaction";

    const is_edge = crossing.ids.has(id);
    for (const s of raw) {
      const outflow_id = (s.outflowId as string | null) ?? null;
      const inflow_id = (s.inflowId as string | null) ?? null;
      // Recurring-linked splits are tracked as bills/income, not budget lines — unless the link
      // points to a bill / income in another view, or this is edge money (D12).
      const linked_here =
        (outflow_id && !out_of_view_ids.has(outflow_id)) ||
        (inflow_id && !out_of_view_ids.has(inflow_id));
      if (linked_here && !is_edge) continue;

      const match = map_raw_split_to_on_read_match(s, {
        txn_date_ms: date_ms,
        is_pending,
        is_transfer: txn_is_internal_transfer,
        is_income: data.type === "income",
      });
      if (is_edge && crossing.out_ids.has(id)) match.is_edge_out = true;

      if (resolve_split_owner(match, real_budgets, ee_id) !== budget_id) continue;

      // Derive the display status (transfers/income → ignored; else the stored status).
      let spend_status: DerivedSpendStatus = match.spend_status;
      let ignored_reason: IgnoredReason = null;
      if (txn_is_internal_transfer) {
        spend_status = "ignored";
        ignored_reason = "transfer";
      } else if (is_income_category(match.internal_match_category ?? match.plaid_match_category)) {
        spend_status = "ignored";
        ignored_reason = "income";
      } else if (match.spend_status === "ignored") {
        ignored_reason = "manual";
      }

      out.push({
        transaction_id: id,
        split_id: (s.splitId as string) ?? (s.id as string) ?? null,
        date_ms,
        name,
        amount: Math.abs((s.amount as number) ?? 0),
        is_pending,
        spend_status,
        ignored_reason,
      });
    }
  }

  // Newest first.
  out.sort((a, b) => b.date_ms - a.date_ms);

  // Cache the result stamped with the pre-compute version (fire-and-forget; skips if a heavy
  // budget's list exceeds the size guard, in which case that call just stays uncached).
  fire_and_forget(() => put_cached_result(BUDGET_TXN_CACHE, cache_id, data_version, out));
  return out;
}
