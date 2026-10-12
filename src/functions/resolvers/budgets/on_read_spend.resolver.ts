/**
 * On-Read Spend Resolver
 *
 * READ-ONLY gathering for the "instant budgets" path (Derive-On-Read): produce
 * the splits a budget owns by matching them ON READ (category + manual pin),
 * NOT by reading a pre-computed stored `budgetId`. This is what lets a brand-new
 * budget show its transactions immediately — no write-time assignment cascade.
 *
 * Loads the user's budgets (to know category ownership + the Everything-Else
 * fallback) + the splits in the window, maps them to the matcher's shape, and
 * returns the target budget's owned splits as `SplitForSpend[]` — which flow
 * straight into the existing `budget_view` derivation (bucketing + pro-ration).
 *
 * Reuses the pure `owned_splits_for_budget` (which reuses `match_budget`), so it
 * makes the identical decisions the write-time engine would. No writes.
 *
 * @module resolvers/budgets/on_read_spend
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { budget_repo } from "../../repositories/budget.repo";
import { transaction_repo } from "../../repositories/transaction.repo";
import {
  budget_to_match_input,
  build_match_budgets,
} from "../../domain/budgets/match_budgets.service";
import { load_category_catalog } from "../shared/category_catalog.resolver";
import { SplitForSpend } from "../../domain/budgets/budget_spend.service";
import {
  owned_splits_for_budget,
  SplitForOnReadMatch,
} from "../../domain/budgets/budget_spend_match.service";
import {
  BudgetForMatch,
} from "../../domain/transactions/match_budget.service";
import {
  detect_internal_transfers_from_txns,
  map_raw_split_to_on_read_match,
} from "../shared/on_read_matching";

/**
 * The splits owned by `target_budget_id` over the window, resolved on read.
 *
 * @param target_is_ee - Whether the target budget is the Everything-Else budget.
 *                       When true, the matcher's EE fallback id is the target
 *                       itself (so unmatched splits land here); otherwise a real
 *                       budget only receives its category matches.
 */
export async function resolve_on_read_spend_splits(
  ctx: TraceContext,
  user_id: string,
  target_budget_id: string,
  target_is_ee: boolean,
  start_ms: number,
  end_ms: number
): Promise<SplitForSpend[]> {
  // 1. Load the user's budgets → real budgets (for category ownership) + the EE id.
  const budgets = await budget_repo.get_by_user_id(ctx, user_id);
  const catalog = await load_category_catalog(ctx);
  // THE budget set (domain/budgets/match_budgets) — same as the period page and the engine.
  const match = build_match_budgets(budgets.map(budget_to_match_input));
  const real_budgets: BudgetForMatch[] = match.real_budgets;
  // For a real target the EE id is irrelevant (it only receives category matches);
  // for the EE target the fallback must route unmatched splits to the target.
  const ee_id = target_is_ee ? target_budget_id : match.primary_everything_else_id;

  // 2. Load the window's transactions and map splits to the matcher's shape.
  const txns = await transaction_repo.get_active_in_date_range(ctx, user_id, start_ms, end_ms);
  // Only INTERNAL (matched-pair own-account) transfers are excluded from spend —
  // external ACH bills Plaid tags TRANSFER stay countable. Same rule everywhere.
  const { internal_ids } = detect_internal_transfers_from_txns(txns, catalog);
  const splits: SplitForOnReadMatch[] = [];
  for (const { id, data: d } of txns) {
    const txn_date_ms = (d.transactionDate as Timestamp).toMillis();
    const is_pending = d.isPending === true;
    const txn_is_internal_transfer = internal_ids.has(id);
    const txn_is_income = d.type === "income";
    const raw = (d.splits as Array<Record<string, unknown>>) ?? [];
    for (const s of raw) {
      splits.push(
        map_raw_split_to_on_read_match(s, {
          txn_date_ms,
          is_pending,
          is_transfer: txn_is_internal_transfer,
          is_income: txn_is_income,
          merchant_name: (d.merchantName as string | null) ?? null,
          name: (d.name as string | null) ?? null,
        }, catalog)
      );
    }
  }

  // 3. Pure match → the target's owned splits.
  return owned_splits_for_budget(
    target_budget_id,
    real_budgets,
    ee_id,
    splits,
    match.everything_else_id_set
  );
}
