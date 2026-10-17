/**
 * Convert Resolver — READ-ONLY facts for converting a transaction into a bill / income, and for
 * previewing it (Convert-To-Recurring Phase 2).
 *
 * Authorization comes FIRST: the transaction's owner must be the caller (D24 — a group member can't
 * convert the other person's transaction, and nothing else is read for them, so nothing leaks).
 * Then it loads exactly what the pure rules need: the user's shown bills / income (what already
 * claims the payment, which Plaid payments belong to a live stream), the account's sharing
 * placement (D45) and the vendor's payments on that account (one query on the existing
 * `(userId, isActive, vendorKey, transactionDate)` index; the account is filtered in memory).
 *
 * @module resolvers/recurring/convert
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { transaction_repo } from "../../repositories/transaction.repo";
import { outflow_repo } from "../../repositories/outflow.repo";
import { inflow_repo } from "../../repositories/inflow.repo";
import { account_repo } from "../../repositories/account.repo";
import { vendor_key as vendor_key_of } from "../../domain/transactions/vendor_key.service";
import { ConvertFacts, ConvertTxnFacts, direction_of, retro_floor_ms } from "../../domain/recurring/convert_plan.service";
import { splits_paying_recurring } from "../../domain/recurring/stream_membership";

export type ConvertResolution =
  | { ok: false; reason: "not_found" | "permission_denied" }
  | {
    ok: true;
    facts: ConvertFacts;
    /** A record this transaction was already converted into (a double tap / a timed-out convert). */
    existing_conversion: { id: string; name: string; live: boolean; retro_done: boolean } | null;
    /** Old, turned-off / stale records of the same direction + account + vendor (D41): a convert
     *  over them is a user-tapped "Same bill" — they end and merge into the new record. */
    old_bills: OldBill[];
  };

export interface OldBill {
  id: string;
  removal_intervals: import("../../domain/recurring/recurring_suppression.service").RemovalInterval[];
  user_custom_name: string | null;
  expected_amount_override: number | null;
  user_frequency: string | null;
  last_payment_ms: number | null;
  merged_into_id: string | null;
  account_id: string | null;
}

type Raw = Record<string, unknown>;

/** The raw transaction doc → the facts the rules read. */
export function txn_facts(doc_id: string, d: Raw, in_shown_stream: boolean): ConvertTxnFacts {
  const splits = (d.splits as Array<Raw> | undefined) ?? [];
  const source = [d.merchantName, d.name, d.description]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .find((v) => v.length > 0) ?? null;
  const stored_key = typeof d.vendorKey === "string" && d.vendorKey.length > 0 ? d.vendorKey : null;
  const first = splits[0] ?? {};
  return {
    doc_id,
    plaid_id: (d.transactionId as string | undefined) ?? null,
    type: (d.type as string | undefined) ?? null,
    account_id: (d.accountId as string | undefined) ?? "",
    date_ms: (d.transactionDate as Timestamp | undefined)?.toMillis?.() ?? 0,
    amount: typeof d.amount === "number" ? d.amount : splits.reduce((s, x) => s + (Number(x.amount) || 0), 0),
    is_pending: d.isPending === true,
    is_active: d.isActive !== false,
    transfer_role: (d.transferRole as string | undefined) ?? null,
    plaid_primary_category: (first.plaidPrimaryCategory as string | undefined) ?? (d.plaidPrimaryCategory as string | undefined) ?? null,
    plaid_detailed_category: (first.plaidDetailedCategory as string | undefined) ?? (d.plaidDetailedCategory as string | undefined) ?? null,
    vendor_source: source,
    vendor_key: stored_key ?? vendor_key_of({
      merchant_name: d.merchantName as string | null | undefined,
      name: d.name as string | null | undefined,
      description: d.description as string | null | undefined,
    }),
    splits: splits.map((s) => ({
      split_id: String(s.splitId ?? ""),
      outflow_id: (s.outflowId as string | null | undefined) ?? null,
      inflow_id: (s.inflowId as string | null | undefined) ?? null,
    })),
    in_shown_stream,
  };
}

/** A record's display name (the user's, else the merchant / payer, else its description). */
function record_name(r: { user_custom_name: string | null; description: string | null; merchant_name?: string | null; payer_name?: string | null }): string {
  return r.user_custom_name || r.merchant_name || r.payer_name || r.description || "a bill";
}

export async function resolve_convert_facts(
  ctx: TraceContext,
  user_id: string,
  transaction_id: string,
  now_ms: number
): Promise<ConvertResolution> {
  const txn = await transaction_repo.get_raw_by_id(ctx, transaction_id);
  if (!txn) return { ok: false, reason: "not_found" };
  const owner = (txn.data.ownerId as string | undefined) ?? (txn.data.userId as string | undefined);
  if (owner !== user_id) return { ok: false, reason: "permission_denied" };

  const [outflows, inflows, accounts] = await Promise.all([
    outflow_repo.get_by_user_id(ctx, user_id),
    inflow_repo.get_by_user_id(ctx, user_id),
    account_repo.get_by_user_id(ctx, user_id),
  ]);
  const shown = (r: { is_active: boolean; is_hidden: boolean; merged_into_id?: string | null }) =>
    r.is_active && !r.is_hidden && !r.merged_into_id;
  const shown_out = outflows.filter(shown);
  const shown_in = inflows.filter(shown);
  const stream_ids = new Set([...shown_out, ...shown_in].flatMap((r) => r.transaction_ids ?? []));

  const base = txn_facts(txn.id, txn.data, false);
  const direction = direction_of(base.type);

  // D41: stopped records (inactive, not merged) of this vendor on this account — read only for a
  // transaction that can convert (one small owner-scoped query). Their Plaid payments are history of
  // THEIR bill: the retro-link never takes them.
  let old_bills: OldBill[] = [];
  if (direction && base.vendor_key && base.account_id) {
    const inactive = direction === "inflow"
      ? await inflow_repo.get_inactive_by_user_id(ctx, user_id)
      : await outflow_repo.get_inactive_by_user_id(ctx, user_id);
    const matching = inactive.filter((r) =>
      !r.merged_into_id && r.account_id === base.account_id &&
      vendor_key_of({
        merchant_name: "merchant_name" in r ? (r as { merchant_name?: string | null }).merchant_name : (r as { payer_name?: string | null }).payer_name,
        name: r.description,
      }) === base.vendor_key);
    old_bills = matching.map((r) => ({
      id: r.id, removal_intervals: r.removal_intervals, user_custom_name: r.user_custom_name,
      expected_amount_override: r.expected_amount_override, user_frequency: r.user_frequency ?? null,
      last_payment_ms: (r.last_date as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null,
      merged_into_id: r.merged_into_id, account_id: r.account_id,
    }));
    for (const r of matching) for (const t of r.transaction_ids ?? []) stream_ids.add(t);
  }
  const own = txn_facts(txn.id, txn.data, !!base.plaid_id && stream_ids.has(base.plaid_id));

  // What already claims the source: a split link to a shown record, or its Plaid stream (a split
  // taken off the stream by a detach / budget pin doesn't count).
  const records = direction === "inflow" ? shown_in : shown_out;
  const kind = direction === "inflow" ? "inflow" : "outflow";
  const raw_splits = (txn.data.splits as Array<Raw> | undefined) ?? [];
  let claimed_by: { id: string; name: string } | null = null;
  for (const r of records) {
    const in_stream = !!base.plaid_id && (r.transaction_ids ?? []).includes(base.plaid_id);
    if (splits_paying_recurring(raw_splits, kind, r.id, in_stream).length > 0) {
      claimed_by = { id: r.id, name: record_name(r) };
      break;
    }
  }

  // A record already converted from THIS transaction (double tap / timed-out convert): resume it.
  const prior = [...outflows, ...inflows].find((r) => r.converted_from_txn_id === txn.id && r.is_active);
  const existing_conversion = prior
    ? {
      id: prior.id,
      name: record_name(prior),
      live: shown(prior) && !prior.removed_by_user,
      retro_done: (prior.retro_linked_at_ms ?? null) !== null,
    }
    : null;
  if (existing_conversion) claimed_by = null; // its own claim is not "another bill"

  const acct = accounts.find((a) => a.id === own.account_id || a.account_id === own.account_id);
  const placement = acct?.placement
    ? { group_id: acct.placement.group_id, shared_from_ms: acct.placement.shared_from_ms ?? null }
    : null;

  const facts: ConvertFacts = {
    user_id, txn: own, vendor_txns: [], claimed_by, placement, now_ms,
  };
  // The vendor's other payments (only worth reading for a transaction that can convert).
  if (own.vendor_key && own.account_id && !existing_conversion) {
    const rows = await transaction_repo.get_by_vendor_key(ctx, user_id, own.vendor_key, retro_floor_ms(facts));
    facts.vendor_txns = rows.map((r) => {
      const f = txn_facts(r.id, r.data, false);
      return { ...f, in_shown_stream: !!f.plaid_id && stream_ids.has(f.plaid_id) };
    });
  }
  return { ok: true, facts, existing_conversion, old_bills };
}
