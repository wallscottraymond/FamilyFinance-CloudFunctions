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

import { enqueue_item_sync } from "./sync_item.orchestrator";
import { TraceContext } from "../../types";
import { plaid_item_repo } from "../../repositories/plaid/plaid_item.repo";
import { sync_balances_orchestrator } from "./sync_balances.orchestrator";
import { generate_id } from "../../observability";

export interface SyncAllTransactionsResult {
  items_total: number;
  items_synced: number;
  items_failed: number;
  added_total: number;
  modified_total: number;
  removed_total: number;
  balances_updated_total: number;
  /** One per connection refreshed, the number AF-15 measures. */
  balance_calls_total: number;
}

/** The 6-hourly run that refreshes balances: 12:00 UTC, early morning across the US. */
const DAILY_BALANCE_HOUR_UTC = 12;

export function is_daily_balance_run(now_ms: number): boolean {
  return new Date(now_ms).getUTCHours() === DAILY_BALANCE_HOUR_UTC;
}

export async function sync_all_transactions_orchestrator(
  ctx: TraceContext,
  now_ms: number = Date.now()
): Promise<SyncAllTransactionsResult> {
  const items = await plaid_item_repo.get_all_active(ctx);

  const result: SyncAllTransactionsResult = {
    items_total: items.length,
    items_synced: 0,
    items_failed: 0,
    added_total: 0,
    modified_total: 0,
    removed_total: 0,
    balances_updated_total: 0,
    balance_calls_total: 0,
  };

  for (const item of items) {
    // Skip re-auth-needed items — Plaid rejects their sync/balance calls until the user relinks,
    // so retrying every 6h just burns reads + a failed Plaid call. The relink flow re-enables them.
    if (item.status === "item_login_required") {
      continue;
    }
    try {
      // Queue the item sync (its own job + lease) instead of syncing inline here: one cron run no
      // longer syncs every item serially inside one 9-minute function, and it can't overlap a
      // webhook-driven sync of the same item.
      await enqueue_item_sync({
        item_doc_id: item.item_doc_id,
        user_id: item.user_id,
        reason: "cron:sync_all_transactions",
        trace_id: ctx.trace_id,
      });
      result.items_synced++;
    } catch (error) {
      result.items_failed++;
      console.error(`[${ctx.trace_id}] failed to queue sync for item ${item.plaid_item_id}:`, error);
    }

    // Balances once a day (AF-15): they rarely change between syncs, and pull to refresh stays live.
    if (!is_daily_balance_run(now_ms)) continue;

    // Refresh balances independently — a transaction-sync failure above must not
    // skip the balance refresh, and vice versa. The balance resolver looks up by
    // `plaidItemId`, so pass the external id. Best-effort per item.
    try {
      result.balance_calls_total++;
      const balance = await sync_balances_orchestrator({
        trace_id: ctx.trace_id,
        span_id: generate_id(),
        user_id: item.user_id,
        idempotency_key: `scheduled_balance:${item.plaid_item_id}:${ctx.trace_id}`,
        input: { item_id: item.plaid_item_id },
      });
      result.balances_updated_total += balance.accounts_updated ?? 0;
    } catch (error) {
      console.error(
        `[${ctx.trace_id}] scheduled balance sync threw for item ${item.plaid_item_id}:`,
        error
      );
    }
  }

  return result;
}
