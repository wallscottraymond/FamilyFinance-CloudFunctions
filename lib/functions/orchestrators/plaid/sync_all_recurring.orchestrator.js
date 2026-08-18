"use strict";
/**
 * Sync All Recurring Orchestrator (scheduled fallback)
 *
 * Iterates every active Plaid item across all users and runs the recurring
 * (bill/income stream) sync for each. This is the safety net for recurring
 * streams: Plaid's `RECURRING_TRANSACTIONS_UPDATE` webhooks are infrequent and
 * unreliable (they only fire when Plaid detects a stream change), so without a
 * scheduled sweep the recurring definitions — new bills/income, amount/frequency
 * changes, predicted next dates, `transactionIds` — go stale between links.
 * Mirrors `sync_all_transactions` (which does the same for transactions). Per-item
 * failures are isolated so one bad item can't stop the rest.
 *
 * @module orchestrators/plaid/sync_all_recurring
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sync_all_recurring_orchestrator = sync_all_recurring_orchestrator;
const plaid_item_repo_1 = require("../../repositories/plaid/plaid_item.repo");
const sync_recurring_orchestrator_1 = require("./sync_recurring.orchestrator");
const observability_1 = require("../../observability");
async function sync_all_recurring_orchestrator(ctx) {
    var _a, _b, _c, _d;
    const items = await plaid_item_repo_1.plaid_item_repo.get_all_active(ctx);
    const result = {
        items_total: items.length,
        items_synced: 0,
        items_failed: 0,
        outflows_synced_total: 0,
        inflows_synced_total: 0,
        stale_total: 0,
    };
    for (const item of items) {
        try {
            const sync = await (0, sync_recurring_orchestrator_1.sync_recurring_orchestrator)({
                trace_id: ctx.trace_id,
                span_id: (0, observability_1.generate_id)(),
                user_id: item.user_id,
                idempotency_key: `scheduled_recurring:${item.plaid_item_id}:${ctx.trace_id}`,
                input: { item_id: item.plaid_item_id, is_webhook: false },
            });
            if (sync.success) {
                result.items_synced++;
                result.outflows_synced_total += (_a = sync.outflows_synced) !== null && _a !== void 0 ? _a : 0;
                result.inflows_synced_total += (_b = sync.inflows_synced) !== null && _b !== void 0 ? _b : 0;
                result.stale_total += ((_c = sync.outflows_stale) !== null && _c !== void 0 ? _c : 0) + ((_d = sync.inflows_stale) !== null && _d !== void 0 ? _d : 0);
            }
            else {
                result.items_failed++;
                console.warn(`[${ctx.trace_id}] scheduled recurring sync failed for item ${item.plaid_item_id}: ${sync.error}`);
            }
        }
        catch (error) {
            result.items_failed++;
            console.error(`[${ctx.trace_id}] scheduled recurring sync threw for item ${item.plaid_item_id}:`, error);
        }
    }
    return result;
}
//# sourceMappingURL=sync_all_recurring.orchestrator.js.map