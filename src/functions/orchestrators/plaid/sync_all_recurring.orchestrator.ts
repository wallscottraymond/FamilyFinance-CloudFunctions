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
import { plaid_item_repo } from "../../repositories/plaid/plaid_item.repo";
import { sync_recurring_orchestrator } from "./sync_recurring.orchestrator";
import { generate_id } from "../../observability";

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
    try {
      const sync = await sync_recurring_orchestrator({
        trace_id: ctx.trace_id,
        span_id: generate_id(),
        user_id: item.user_id,
        idempotency_key: `scheduled_recurring:${item.plaid_item_id}:${ctx.trace_id}`,
        input: { item_id: item.plaid_item_id, is_webhook: false },
      });
      if (sync.success) {
        result.items_synced++;
        result.outflows_synced_total += sync.outflows_synced ?? 0;
        result.inflows_synced_total += sync.inflows_synced ?? 0;
        result.stale_total += (sync.outflows_stale ?? 0) + (sync.inflows_stale ?? 0);
      } else {
        result.items_failed++;
        console.warn(
          `[${ctx.trace_id}] scheduled recurring sync failed for item ${item.plaid_item_id}: ${sync.error}`
        );
      }
    } catch (error) {
      result.items_failed++;
      console.error(
        `[${ctx.trace_id}] scheduled recurring sync threw for item ${item.plaid_item_id}:`,
        error
      );
    }
  }

  return result;
}
