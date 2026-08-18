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
import { TraceContext } from "../../types";
export interface SyncAllRecurringResult {
    items_total: number;
    items_synced: number;
    items_failed: number;
    outflows_synced_total: number;
    inflows_synced_total: number;
    stale_total: number;
}
export declare function sync_all_recurring_orchestrator(ctx: TraceContext): Promise<SyncAllRecurringResult>;
//# sourceMappingURL=sync_all_recurring.orchestrator.d.ts.map