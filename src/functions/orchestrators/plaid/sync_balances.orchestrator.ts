/**
 * Sync Balances Orchestrator
 *
 * Coordinates the balance synchronization flow:
 * 1. Resolver: Get items with access tokens
 * 2. Integration: Fetch accounts/balances from Plaid
 * 3. Repository: Upsert accounts (create if new, update balances if exists)
 * 4. Events: Emit balance_updated events for changes
 *
 * Uses the same upsert logic as initial sync for consistency.
 *
 * @module orchestrators/plaid/sync_balances
 */

import {
  OrchestratorContext,
} from "../../types";
import { create_child_span } from "../../observability";
import {
  SyncBalancesInput,
  SyncBalancesResponse,
  BalanceSyncItemResult,
  BalanceSyncAccountResult,
  BalanceUpdatedEventPayload,
  SYNC_BALANCES_BUDGET,
} from "../../types/plaid";
import { resolve_balance_sync_dependencies } from "../../resolvers/plaid/balance_sync.resolver";
import {
  create_account_success_result,
  create_item_success_result,
  create_item_failure_result,
  aggregate_balance_sync_results,
} from "../../domain/plaid/balance_sync.service";
import { fetch_plaid_balances } from "../../integrations/plaid";
import { account_repo } from "../../repositories/account.repo";
import { ACCOUNT_EVENTS } from "../../events/account.events";

/**
 * Orchestrates the balance synchronization flow.
 *
 * Uses the same upsert_from_plaid() method as initial sync to ensure
 * consistent behavior: creates accounts if they don't exist, updates
 * balances if they do.
 *
 * @param ctx - Orchestrator context with input and user info
 * @returns Sync results with updated account counts
 */
export async function sync_balances_orchestrator(
  ctx: OrchestratorContext<SyncBalancesInput>
): Promise<SyncBalancesResponse> {
  const start_time = Date.now();

  console.log(
    `[${ctx.trace_id}] Starting balance sync for user ${ctx.user_id}` +
    (ctx.input.item_id ? `, item ${ctx.input.item_id}` : "")
  );

  // 1. RESOLVE DEPENDENCIES
  const deps = await resolve_balance_sync_dependencies(
    create_child_span(ctx),
    {
      user_id: ctx.user_id,
      item_id: ctx.input.item_id,
      account_ids: ctx.input.account_ids,
    }
  );

  if (deps.items.length === 0) {
    console.log(`[${ctx.trace_id}] No active Plaid items found`);
    // Still fetch accounts to return current state
    const accounts = await account_repo.get_for_client_response(
      create_child_span(ctx),
      ctx.user_id,
      ctx.input.item_id
    );
    return {
      success: true,
      accounts_updated: 0,
      accounts_failed: 0,
      items: [],
      balance_changes: [],
      accounts,
    };
  }

  // 2. PROCESS EACH ITEM
  const item_results: BalanceSyncItemResult[] = [];
  const events_to_emit: BalanceUpdatedEventPayload[] = [];

  for (const item of deps.items) {
    // 2a. FETCH ACCOUNTS/BALANCES FROM PLAID (with retry)
    let plaid_result;
    let retry_count = 0;
    const max_retries = 1;

    while (retry_count <= max_retries) {
      try {
        plaid_result = await fetch_plaid_balances(
          item.access_token,
          ctx.input.account_ids // Optional filter
        );
        break; // Success, exit retry loop
      } catch (error) {
        retry_count++;
        if (retry_count > max_retries) {
          const error_msg = error instanceof Error ? error.message : "Unknown error";
          console.error(
            `[${ctx.trace_id}] Failed to fetch balances for item ${item.item_id} after ${retry_count} attempts:`,
            error_msg
          );
          item_results.push(create_item_failure_result(item.item_id, error_msg));
          break;
        }
        console.warn(
          `[${ctx.trace_id}] Retry ${retry_count} for item ${item.item_id}`
        );
        // Brief delay before retry
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    if (!plaid_result) {
      continue; // Already logged error above
    }

    if (plaid_result.accounts.length === 0) {
      console.log(
        `[${ctx.trace_id}] No accounts returned from Plaid for item ${item.item_id}`
      );
      item_results.push(create_item_success_result(item.item_id, []));
      continue;
    }

    // 2b. UPSERT ACCOUNTS (creates if new, updates balances if exists)
    try {
      const upsert_result = await account_repo.upsert_from_plaid(
        create_child_span(ctx),
        plaid_result.accounts,
        item.item_id,
        ctx.user_id,
        { id: item.institution_id, name: item.institution_name },
        item.group_id
      );

      // 2c. BUILD ACCOUNT RESULTS
      const account_results: BalanceSyncAccountResult[] = [];

      for (const result of upsert_result.results) {
        account_results.push(
          create_account_success_result(
            result.doc_id,
            result.previous_balance ?? result.new_balance, // Use new if no previous (created)
            result.new_balance
          )
        );

        // Track for event emission if balance changed
        if (
          result.action === "updated" &&
          result.previous_balance !== undefined &&
          result.previous_balance !== result.new_balance
        ) {
          events_to_emit.push({
            account_id: result.doc_id,
            user_id: ctx.user_id,
            previous_balance: result.previous_balance,
            new_balance: result.new_balance,
            change_amount: result.new_balance - result.previous_balance,
          });
        }
      }

      console.log(
        `[${ctx.trace_id}] Item ${item.item_id}: created=${upsert_result.created}, updated=${upsert_result.updated}`
      );

      item_results.push(create_item_success_result(item.item_id, account_results));

    } catch (error) {
      const error_msg = error instanceof Error ? error.message : "Unknown error";
      console.error(
        `[${ctx.trace_id}] Failed to upsert accounts for item ${item.item_id}:`,
        error_msg
      );
      item_results.push(create_item_failure_result(item.item_id, error_msg));
    }
  }

  // 3. EMIT EVENTS for balance changes
  for (const event_payload of events_to_emit) {
    try {
      await ACCOUNT_EVENTS.emit_balance_updated(ctx, event_payload);
    } catch (error) {
      // Log but don't fail the sync
      console.error(
        `[${ctx.trace_id}] Failed to emit balance_updated event for account ${event_payload.account_id}:`,
        error
      );
    }
  }

  // 4. AGGREGATE RESULTS
  const result = aggregate_balance_sync_results(item_results);

  // 5. FETCH UPDATED ACCOUNTS for response
  const accounts = await account_repo.get_for_client_response(
    create_child_span(ctx),
    ctx.user_id,
    ctx.input.item_id
  );

  const duration_ms = Date.now() - start_time;
  console.log(
    `[${ctx.trace_id}] Balance sync completed in ${duration_ms}ms: ` +
    `${result.accounts_updated} updated, ${result.accounts_failed} failed, ` +
    `${result.balance_changes.length} changes`
  );

  // Check performance budget
  if (duration_ms > SYNC_BALANCES_BUDGET.max_time_ms) {
    console.warn(
      `[${ctx.trace_id}] Balance sync exceeded time budget: ${duration_ms}ms > ${SYNC_BALANCES_BUDGET.max_time_ms}ms`
    );
  }

  return {
    ...result,
    accounts,
  };
}
