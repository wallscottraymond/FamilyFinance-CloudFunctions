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
export declare function save_item_accounts(ctx: TraceContext, item_doc_id: string, item: Record<string, unknown>, user_id: string): Promise<{
    created: number;
    updated: number;
}>;
//# sourceMappingURL=save_item_accounts.d.ts.map