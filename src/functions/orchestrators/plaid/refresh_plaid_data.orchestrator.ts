/**
 * Refresh Plaid Data Orchestrator
 *
 * Coordinates the combined balance + transaction sync flow
 * triggered by pull-to-refresh in the mobile app.
 *
 * Flow:
 * 1. Resolve dependencies (items, user context)
 * 2. Sync balances for all items
 * 3. Sync transactions for each item
 * 4. Aggregate results
 * 5. Update sync timestamps
 *
 * @module orchestrators/plaid/refresh_plaid_data
 */

import { OrchestratorContext } from "../../types";
import { TransactionSyncInput } from "../../types/plaid";
import { create_child_span } from "../../observability";
import {
  RefreshPlaidDataInput,
  RefreshPlaidDataResponse,
  TransactionSyncPhaseResult,
  REFRESH_PLAID_DATA_BUDGET,
} from "../../types/plaid/refresh_plaid_data.types";
import {
  resolve_refresh_dependencies,
} from "../../resolvers/plaid/refresh_plaid_data.resolver";
import { plaid_item_repo } from "../../repositories/plaid";
import {
  aggregate_refresh_results,
  create_refresh_failure_response,
  create_balance_phase_result,
  create_transaction_phase_result,
  validate_refresh_request,
} from "../../domain/plaid/refresh_plaid_data.service";
import { sync_balances_orchestrator } from "./sync_balances.orchestrator";
import { sync_transactions_orchestrator } from "./sync_transactions.orchestrator";

/**
 * Orchestrates the combined balance + transaction refresh.
 *
 * This orchestrator:
 * 1. Syncs balances first (creates/updates accounts)
 * 2. Syncs transactions for each Plaid item
 * 3. Returns aggregated results
 *
 * Balance sync failures are critical and abort the operation.
 * Transaction sync failures are logged but don't abort (partial success).
 *
 * @param ctx - Orchestrator context with input and user info
 * @returns Combined sync results
 */
export async function refresh_plaid_data_orchestrator(
  ctx: OrchestratorContext<RefreshPlaidDataInput>
): Promise<RefreshPlaidDataResponse> {
  const start_time = Date.now();

  console.log(
    `[${ctx.trace_id}] Starting refresh_plaid_data for user ${ctx.user_id}`
  );

  // 1. RESOLVE DEPENDENCIES
  const deps = await resolve_refresh_dependencies(
    create_child_span(ctx),
    {
      user_id: ctx.user_id,
      item_id: ctx.input.item_id,
      account_ids: ctx.input.account_ids,
    }
  );

  if (!deps) {
    return create_refresh_failure_response(
      "No Plaid items found. Please link a bank account first."
    );
  }

  // 2. VALIDATE REQUEST
  const validation = validate_refresh_request(
    deps.items.length + deps.rate_limited_items.length,
    deps.rate_limited_items.length
  );

  if (!validation.valid) {
    return create_refresh_failure_response(validation.error!);
  }

  // If all items are rate limited, return early with message
  if (deps.items.length === 0) {
    return {
      success: true,
      accounts: [],
      accounts_updated: 0,
      accounts_failed: 0,
      balance_changes: 0,
      transactions_added: 0,
      transactions_modified: 0,
      transactions_removed: 0,
      pending_migrated: 0,
      items_synced: 0,
      items_failed: 0,
      items_rate_limited: deps.rate_limited_items.length,
      errors: ["All items are rate limited. Please wait before refreshing."],
    };
  }

  // 3. SYNC BALANCES (Critical - failures abort)
  console.log(`[${ctx.trace_id}] Phase 1: Syncing balances`);

  let balance_result;
  try {
    balance_result = await sync_balances_orchestrator({
      ...create_child_span(ctx),
      input: {
        item_id: ctx.input.item_id,
        account_ids: ctx.input.account_ids,
      },
      user_id: ctx.user_id,
      idempotency_key: `${ctx.idempotency_key}:balances`,
    });

    console.log(
      `[${ctx.trace_id}] Balance sync complete: ${balance_result.accounts_updated} updated`
    );
  } catch (error) {
    const error_msg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[${ctx.trace_id}] Balance sync failed:`, error_msg);
    return create_refresh_failure_response(`Balance sync failed: ${error_msg}`);
  }

  // Build balance phase result
  const balance_phase = create_balance_phase_result(
    balance_result.accounts,
    balance_result.accounts_updated,
    balance_result.accounts_failed,
    balance_result.balance_changes.length,
    [] // SyncBalancesResponse doesn't surface errors, they're logged internally
  );

  // 4. SYNC TRANSACTIONS (Non-critical - partial failures OK)
  console.log(`[${ctx.trace_id}] Phase 2: Syncing transactions for ${deps.items.length} items`);

  const transaction_results: TransactionSyncPhaseResult[] = [];

  for (const item of deps.items) {
    try {
      const tx_ctx: OrchestratorContext<TransactionSyncInput> = {
        ...create_child_span(ctx),
        input: {
          item_id: item.item_id,
          user_id: ctx.user_id,
        },
        user_id: ctx.user_id,
        idempotency_key: `${ctx.idempotency_key}:tx:${item.item_id}`,
      };

      const tx_result = await sync_transactions_orchestrator(tx_ctx);

      transaction_results.push(
        create_transaction_phase_result(item.item_id, tx_result)
      );

      // Update last sync timestamp on success (via Repository layer)
      if (tx_result.success) {
        await plaid_item_repo.update_last_synced_at(create_child_span(ctx), item.doc_id);
      }

      console.log(
        `[${ctx.trace_id}] Transaction sync for ${item.item_id}: ` +
          `added=${tx_result.added_count}, modified=${tx_result.modified_count}`
      );
    } catch (error) {
      const error_msg = error instanceof Error ? error.message : "Unknown error";
      console.error(
        `[${ctx.trace_id}] Transaction sync failed for ${item.item_id}:`,
        error_msg
      );

      transaction_results.push({
        success: false,
        item_id: item.item_id,
        added_count: 0,
        modified_count: 0,
        removed_count: 0,
        pending_migrated_count: 0,
        error: error_msg,
      });
    }
  }

  // 5. AGGREGATE RESULTS
  const result = aggregate_refresh_results(
    balance_phase,
    transaction_results,
    deps.rate_limited_items
  );

  // 6. LOG COMPLETION
  const duration_ms = Date.now() - start_time;

  console.log(
    `[${ctx.trace_id}] Refresh complete in ${duration_ms}ms: ` +
      `accounts=${result.accounts_updated}, ` +
      `tx_added=${result.transactions_added}, ` +
      `tx_modified=${result.transactions_modified}, ` +
      `items_synced=${result.items_synced}, ` +
      `items_failed=${result.items_failed}`
  );

  // Warn if over budget
  if (duration_ms > REFRESH_PLAID_DATA_BUDGET.max_time_ms) {
    console.warn(
      `[${ctx.trace_id}] Refresh exceeded time budget: ${duration_ms}ms > ${REFRESH_PLAID_DATA_BUDGET.max_time_ms}ms`
    );
  }

  return result;
}
