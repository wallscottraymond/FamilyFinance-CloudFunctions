"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.save_item_accounts = save_item_accounts;
const account_repo_1 = require("../../repositories/account.repo");
const plaid_1 = require("../../integrations/plaid");
const encryption_1 = require("../../../utils/encryption");
async function save_item_accounts(ctx, item_doc_id, item, user_id) {
    const access_token = (0, encryption_1.decryptAccessToken)(item.accessToken);
    const [raw, raw_liabilities] = await Promise.all([
        (0, plaid_1.fetch_plaid_accounts)(access_token),
        (0, plaid_1.safe_fetch_liabilities)(access_token, ctx.trace_id),
    ]);
    const accounts = (0, plaid_1.plaid_accounts_to_data)(raw.accounts);
    if (accounts.length === 0)
        return { created: 0, updated: 0 };
    const result = await account_repo_1.account_repo.upsert_from_plaid(ctx, accounts, item.plaidItemId, user_id, { id: item.institutionId || "", name: item.institutionName || "Unknown Institution" }, undefined, // accounts start private (Account-Rooted-Sharing)
    (0, plaid_1.plaid_liabilities_to_domain)(raw_liabilities));
    console.log(`[${ctx.trace_id}] save_item_accounts ${item_doc_id}: created=${result.created} updated=${result.updated}`);
    return { created: result.created, updated: result.updated };
}
//# sourceMappingURL=save_item_accounts.js.map