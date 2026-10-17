/**
 * Manual Add Bill / Add Income source resolver (Convert-To-Recurring D43) — READ-ONLY.
 *
 * A hand-added record gets a D1 key ONLY when it comes from a REAL transaction of the caller (its
 * Plaid account + its vendor key); a typed name never makes a key (it would strip the record from
 * fuzzy matching without matching anything). An account the caller picks must be the caller's own
 * (a forged `accountId` is refused). Nothing is read when neither is given.
 *
 * @module resolvers/recurring/manual_source
 */

import { TraceContext } from "../../types";
import { account_repo } from "../../repositories/account.repo";
import { transaction_repo } from "../../repositories/transaction.repo";
import { txn_facts } from "./convert.resolver";

export type ManualSource =
  | { ok: true; account_id: string; vendor_key: string | null; vendor_source: string | null; txn_doc_id: string | null }
  | { ok: false; reason: "account_not_yours" | "transaction_not_yours" | "account_mismatch" };

export async function resolve_manual_source(
  ctx: TraceContext,
  user_id: string,
  input: { account_id?: string | null; source_transaction_id?: string | null }
): Promise<ManualSource> {
  let account_id = input.account_id ?? "";
  let vendor_key: string | null = null;
  let vendor_source: string | null = null;
  let txn_doc_id: string | null = null;
  if (input.source_transaction_id) {
    const txn = await transaction_repo.get_raw_by_id(ctx, input.source_transaction_id);
    const owner = (txn?.data.ownerId as string | undefined) ?? (txn?.data.userId as string | undefined);
    if (!txn || owner !== user_id) return { ok: false, reason: "transaction_not_yours" };
    const f = txn_facts(txn.id, txn.data, false);
    if (account_id && account_id !== f.account_id) return { ok: false, reason: "account_mismatch" };
    account_id = f.account_id;
    vendor_key = f.vendor_key;
    vendor_source = f.vendor_source;
    txn_doc_id = txn.id;
  }
  if (account_id) {
    const accounts = await account_repo.get_by_user_id(ctx, user_id);
    const mine = accounts.find((a) => a.account_id === account_id || a.id === account_id);
    if (!mine) return { ok: false, reason: "account_not_yours" };
    account_id = mine.account_id || mine.id; // always the Plaid account id the payments carry
  }
  return { ok: true, account_id, vendor_key, vendor_source, txn_doc_id };
}
