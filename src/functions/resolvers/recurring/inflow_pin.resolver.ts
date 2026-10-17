/**
 * Inflow Pin Resolver — READ-ONLY facts for pinning a split to an income (Convert-To-Recurring
 * Phase 2). Loads the transaction, the income and the caller's account placements; decides nothing
 * (the domain `plan_inflow_pin` does). Authorization is by OWNER, never by group: a member probing
 * the owner's ids learns nothing (the domain answers a missing and a foreign income the same way).
 *
 * @module resolvers/recurring/inflow_pin
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { transaction_repo } from "../../repositories/transaction.repo";
import { inflow_repo } from "../../repositories/inflow.repo";
import { account_repo, Account } from "../../repositories/account.repo";
import { InflowPinFacts } from "../../domain/recurring/inflow_pin.service";

/** The view an account's payment dated `date_ms` counts in: its group (from the share date), else Me. */
function view_of(accounts: Account[], account_key: string, date_ms: number): string | null {
  const a = accounts.find((x) => x.id === account_key || x.account_id === account_key);
  const p = a?.placement;
  if (!p) return null;
  return p.shared_from_ms === null || date_ms >= p.shared_from_ms ? p.group_id : null;
}

export async function resolve_inflow_pin_facts(
  ctx: TraceContext,
  user_id: string,
  transaction_id: string,
  inflow_id: string | null
): Promise<InflowPinFacts | null> {
  const txn = await transaction_repo.get_raw_by_id(ctx, transaction_id);
  if (!txn) return null;
  const d = txn.data;
  // Nothing else is read for someone else's transaction (no leak, no cost).
  const owner = ((d.ownerId as string | undefined) ?? (d.userId as string | undefined)) ?? null;
  const base = {
    owner_id: owner,
    type: (d.type as string | null | undefined) ?? null,
    transfer_role: (d.transferRole as string | null | undefined) ?? null,
    split_ids: ((d.splits as Array<{ splitId?: string }> | undefined) ?? []).map((s) => s.splitId ?? ""),
  };
  if (owner !== user_id) {
    return { txn: base, inflow: null, txn_view: null, inflow_view: null };
  }
  const [inflow, accounts] = await Promise.all([
    inflow_id ? inflow_repo.get_by_id(ctx, inflow_id) : Promise.resolve(null),
    inflow_id ? account_repo.get_by_user_id(ctx, user_id) : Promise.resolve([] as Account[]),
  ]);
  const date_ms = (d.transactionDate as Timestamp | undefined)?.toMillis?.() ?? 0;
  return {
    txn: base,
    inflow: inflow ? { owner_id: inflow.user_id, is_active: inflow.is_active, is_hidden: inflow.is_hidden } : null,
    txn_view: view_of(accounts, (d.accountId as string | undefined) ?? "", date_ms),
    // The income's account placement applies from its share date, judged at the payment's date
    // (the engine's `of_view` rule).
    inflow_view: inflow ? view_of(accounts, inflow.account_id ?? "", date_ms) : null,
  };
}
