/**
 * Save an item's accounts from Plaid — used at link time and whenever a sync meets an account it
 * has no doc for yet (so its transactions are never dropped).
 *
 * Uses `/accounts/get` (balances Plaid already refreshed during Link — fast, not billed per call)
 * rather than `/accounts/balance/get` (a live bank round trip, often several seconds), with the
 * liabilities fetch in parallel instead of after it.
 *
 * @module orchestrators/plaid/save_item_accounts
 */

import { TraceContext } from "../../types";
import { account_repo } from "../../repositories/account.repo";
import {
  fetch_plaid_accounts,
  plaid_accounts_to_data,
  safe_fetch_liabilities,
  plaid_liabilities_to_domain,
} from "../../integrations/plaid";
import { decryptAccessToken } from "../../../utils/encryption";

export async function save_item_accounts(
  ctx: TraceContext,
  item_doc_id: string,
  item: Record<string, unknown>,
  user_id: string
): Promise<{ created: number; updated: number }> {
  const access_token = decryptAccessToken(item.accessToken as string);
  const [raw, raw_liabilities] = await Promise.all([
    fetch_plaid_accounts(access_token),
    safe_fetch_liabilities(access_token, ctx.trace_id),
  ]);
  const accounts = plaid_accounts_to_data(raw.accounts);
  if (accounts.length === 0) return { created: 0, updated: 0 };
  const result = await account_repo.upsert_from_plaid(
    ctx,
    accounts,
    item.plaidItemId as string,
    user_id,
    { id: (item.institutionId as string) || "", name: (item.institutionName as string) || "Unknown Institution" },
    undefined, // accounts start private (Account-Rooted-Sharing)
    plaid_liabilities_to_domain(raw_liabilities)
  );
  console.log(
    `[${ctx.trace_id}] save_item_accounts ${item_doc_id}: created=${result.created} updated=${result.updated}`
  );
  return { created: result.created, updated: result.updated };
}
