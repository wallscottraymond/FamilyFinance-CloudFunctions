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

import { enqueue_item_sync } from "./sync_item.orchestrator";
import { TraceContext } from "../../types";
import { plaid_item_repo } from "../../repositories/plaid/plaid_item.repo";

export interface SyncAllRecurringResult {
  items_total: number;
  items_synced: number;
  items_failed: number;
  outflows_synced_total: number;
  inflows_synced_total: number;
  stale_total: number;
}

export async function sync_all_recurring_orchestrator(
  ctx: TraceContext
): Promise<SyncAllRecurringResult> {
  const items = await plaid_item_repo.get_all_active(ctx);

  const result: SyncAllRecurringResult = {
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
      await enqueue_item_sync({
        item_doc_id: item.item_doc_id,
        user_id: item.user_id,
        recurring: true,
        reason: "cron:sync_all_recurring",
        trace_id: ctx.trace_id,
      });
      result.items_synced++;
    } catch (error) {
      result.items_failed++;
      console.error(`[${ctx.trace_id}] failed to queue recurring sync for item ${item.plaid_item_id}:`, error);
    }
  }

  return result;
}
