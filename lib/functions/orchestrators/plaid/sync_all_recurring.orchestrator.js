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
const sync_item_orchestrator_1 = require("./sync_item.orchestrator");
const plaid_item_repo_1 = require("../../repositories/plaid/plaid_item.repo");
async function sync_all_recurring_orchestrator(ctx) {
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
        // Skip re-auth-needed items — Plaid rejects their calls until relinked.
        if (item.status === "item_login_required") {
            continue;
        }
        try {
            // Queued per item (lease + one pass) — see sync_item.
            await (0, sync_item_orchestrator_1.enqueue_item_sync)({
                item_doc_id: item.item_doc_id,
                user_id: item.user_id,
                recurring: true,
                reason: "cron:sync_all_recurring",
                trace_id: ctx.trace_id,
            });
            result.items_synced++;
        }
        catch (error) {
            result.items_failed++;
            console.error(`[${ctx.trace_id}] failed to queue recurring sync for item ${item.plaid_item_id}:`, error);
        }
    }
    return result;
}
//# sourceMappingURL=sync_all_recurring.orchestrator.js.map