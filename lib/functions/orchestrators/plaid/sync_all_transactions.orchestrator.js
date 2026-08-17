"use strict";
/**
 * Sync All Transactions Orchestrator (scheduled fallback)
 *
 * Iterates every active Plaid item across all users and runs the standard
 * transaction sync AND a balance refresh for each. This is a safety net: even if
 * a Plaid webhook is missed or rejected, transactions AND account balances still
 * flow on a schedule. (Transaction sync alone does NOT update balances, so
 * without the balance pass here, balances go stale between manual refreshes.)
 * Per-item failures are isolated so one bad item can't stop the rest.
 *
 * @module orchestrators/plaid/sync_all_transactions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sync_all_transactions_orchestrator = sync_all_transactions_orchestrator;
const plaid_item_repo_1 = require("../../repositories/plaid/plaid_item.repo");
const sync_transactions_orchestrator_1 = require("./sync_transactions.orchestrator");
const sync_balances_orchestrator_1 = require("./sync_balances.orchestrator");
const observability_1 = require("../../observability");
async function sync_all_transactions_orchestrator(ctx) {
    var _a;
    const items = await plaid_item_repo_1.plaid_item_repo.get_all_active(ctx);
    const result = {
        items_total: items.length,
        items_synced: 0,
        items_failed: 0,
        added_total: 0,
        modified_total: 0,
        removed_total: 0,
        balances_updated_total: 0,
    };
    for (const item of items) {
        try {
            const sync = await (0, sync_transactions_orchestrator_1.sync_transactions_orchestrator)({
                trace_id: ctx.trace_id,
                span_id: (0, observability_1.generate_id)(),
                user_id: item.user_id,
                idempotency_key: `scheduled_sync:${item.plaid_item_id}:${ctx.trace_id}`,
                input: { item_id: item.plaid_item_id, user_id: item.user_id },
            });
            if (sync.success) {
                result.items_synced++;
                result.added_total += sync.added_count;
                result.modified_total += sync.modified_count;
                result.removed_total += sync.removed_count;
            }
            else {
                result.items_failed++;
                console.warn(`[${ctx.trace_id}] scheduled sync failed for item ${item.plaid_item_id}: ${sync.error}`);
            }
        }
        catch (error) {
            result.items_failed++;
            console.error(`[${ctx.trace_id}] scheduled sync threw for item ${item.plaid_item_id}:`, error);
        }
        // Refresh balances independently — a transaction-sync failure above must not
        // skip the balance refresh, and vice versa. The balance resolver looks up by
        // `plaidItemId`, so pass the external id. Best-effort per item.
        try {
            const balance = await (0, sync_balances_orchestrator_1.sync_balances_orchestrator)({
                trace_id: ctx.trace_id,
                span_id: (0, observability_1.generate_id)(),
                user_id: item.user_id,
                idempotency_key: `scheduled_balance:${item.plaid_item_id}:${ctx.trace_id}`,
                input: { item_id: item.plaid_item_id },
            });
            result.balances_updated_total += (_a = balance.accounts_updated) !== null && _a !== void 0 ? _a : 0;
        }
        catch (error) {
            console.error(`[${ctx.trace_id}] scheduled balance sync threw for item ${item.plaid_item_id}:`, error);
        }
    }
    return result;
}
//# sourceMappingURL=sync_all_transactions.orchestrator.js.map