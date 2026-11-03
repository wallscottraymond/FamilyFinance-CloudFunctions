/**
 * Link posted deposits to the income line whose description they exactly match (AF-08), for the
 * ones Plaid hasn't listed on the stream. Writes the ids to the line, re-assigns those deposits so
 * their splits carry the link, and returns the follow-ups (reconcile, derive version).
 *
 * The ids are kept in their own field and survive Plaid's stream refresh (`inflow.repo`), so every
 * reader keeps using the one `transactionIds`.
 *
 * Reads the user's income lines only when a candidate deposit exists (usually none).
 *
 * @module orchestrators/plaid/link_income_by_payer
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { inflow_repo } from "../../repositories/inflow.repo";
import { transaction_repo, SyncWrittenDoc } from "../../repositories/transaction.repo";
import { assign_transactions_batch_orchestrator } from "../transactions/assign_transactions_batch.orchestrator";
import { load_category_catalog } from "../../resolvers/shared/category_catalog.resolver";
import { resolve_split_category } from "../../domain/transactions/split_category.service";
import { split_category_input_from_raw } from "../../domain/transactions/split_category_edit.service";
import { is_other_income_split } from "../../domain/recurring/stream_membership";
import {
  DepositForPayerMatch,
  match_deposits_to_income_lines,
} from "../../domain/recurring/income_payer_match.service";
import { empty_follow_ups, follow_ups_from_written, merge_follow_ups, SyncFollowUps } from "./sync_follow_ups";

/** A transaction doc as a candidate deposit, or null when it can't be one. */
function to_candidate(
  data: Record<string, unknown>,
  catalog: Awaited<ReturnType<typeof load_category_catalog>>
): DepositForPayerMatch | null {
  const plaid_id = data.transactionId as string | undefined;
  if (!plaid_id || data.type !== "income" || data.isActive === false || data.isPending === true) return null;
  const splits = (data.splits as Array<Record<string, unknown>>) ?? [];
  if (splits.length === 0) return null;
  const is_other_income = splits.every((s) =>
    is_other_income_split(
      s,
      resolve_split_category(split_category_input_from_raw(s, data, catalog), catalog).semantic_code,
      false,
      true
    )
  );
  if (!is_other_income) return null;
  return {
    plaid_id,
    name: (data.name as string | null) ?? null,
    account_id: (data.accountId as string | null) ?? null,
    date_ms: (data.transactionDate as Timestamp).toMillis(),
    is_pending: false,
    is_other_income: true,
  };
}

export async function link_income_by_payer_orchestrator(
  ctx: TraceContext,
  user_id: string,
  run_id: string,
  docs: Array<Record<string, unknown>>
): Promise<{ follow_ups: SyncFollowUps; linked: Map<string, string[]> }> {
  const none = { follow_ups: empty_follow_ups(), linked: new Map<string, string[]>() };
  if (!docs.some((d) => d.type === "income")) return none;
  const catalog = await load_category_catalog(ctx);
  const deposits = docs
    .map((d) => to_candidate(d, catalog))
    .filter((d): d is DepositForPayerMatch => d !== null);
  if (deposits.length === 0) return none;

  const lines = await inflow_repo.get_by_user_id(ctx, user_id);
  const linked = match_deposits_to_income_lines(
    deposits,
    lines.map((l) => ({
      id: l.id,
      description: l.description,
      account_id: l.account_id,
      first_date_ms: l.first_date ? l.first_date.toMillis() : null,
      is_active: l.is_active,
      is_hidden: l.is_hidden,
      transaction_ids: l.transaction_ids ?? [],
      removal_intervals: l.removal_intervals ?? [],
    }))
  );
  if (linked.size === 0) return none;

  await inflow_repo.add_payer_matched_transactions(ctx, linked, run_id);
  const stored = await transaction_repo.get_by_plaid_transaction_ids(ctx, user_id, [...linked.values()].flat());
  const written: SyncWrittenDoc[] = [];
  await assign_transactions_batch_orchestrator(ctx, {
    user_id,
    transaction_ids: stored.map((d) => d.id),
    run_id,
    collect_into: written,
  });
  return {
    linked,
    follow_ups: merge_follow_ups(follow_ups_from_written(written), {
      inflow_ids: [...linked.keys()],
      recurring_changed: true,
    }),
  };
}
