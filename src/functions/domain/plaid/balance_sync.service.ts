/**
 * Balance Sync Domain Service
 *
 * Pure business logic for balance synchronization.
 * NO async, NO IO, NO side effects.
 *
 * @module domain/plaid/balance_sync
 */

import { DomainResult } from "../../types";
import {
  BalanceUpdate,
  BalanceValidationInput,
  BalanceSyncAccountResult,
  BalanceSyncItemResult,
  BalanceSyncAggregatedResult,
} from "../../types/plaid";

/**
 * Validates balance updates before applying.
 *
 * PURE FUNCTION - no IO, deterministic.
 * Currently a passthrough as we trust Plaid data.
 *
 * @param input - Balance updates to validate
 * @returns Domain result with validated updates
 */
export function validate_balance_updates(
  input: BalanceValidationInput
): DomainResult<BalanceUpdate> {
  // Per architecture decision: no validation needed - trust Plaid data
  // This is a passthrough but we keep the layer for consistency
  // and easy extensibility if we need validation later

  if (input.updates.length === 0) {
    return { entities: [] };
  }

  return { entities: input.updates };
}

/**
 * Creates a success result for a single account balance update.
 *
 * PURE FUNCTION.
 */
export function create_account_success_result(
  account_id: string,
  previous_balance: number,
  new_balance: number
): BalanceSyncAccountResult {
  return {
    account_id,
    success: true,
    previous_balance,
    new_balance,
  };
}

/**
 * Creates a failure result for a single account balance update.
 *
 * PURE FUNCTION.
 */
export function create_account_failure_result(
  account_id: string,
  error: string
): BalanceSyncAccountResult {
  return {
    account_id,
    success: false,
    error,
  };
}

/**
 * Creates a success result for a Plaid item sync.
 *
 * PURE FUNCTION.
 */
export function create_item_success_result(
  item_id: string,
  accounts: BalanceSyncAccountResult[]
): BalanceSyncItemResult {
  return {
    item_id,
    success: true,
    accounts,
  };
}

/**
 * Creates a failure result for a Plaid item sync.
 *
 * PURE FUNCTION.
 */
export function create_item_failure_result(
  item_id: string,
  error: string
): BalanceSyncItemResult {
  return {
    item_id,
    success: false,
    accounts: [],
    error,
  };
}

/**
 * Aggregates item results into a partial response.
 * The orchestrator adds `accounts` field after calling this.
 *
 * PURE FUNCTION.
 */
export function aggregate_balance_sync_results(
  items: BalanceSyncItemResult[]
): BalanceSyncAggregatedResult {
  let accounts_updated = 0;
  let accounts_failed = 0;
  const balance_changes: BalanceSyncAggregatedResult["balance_changes"] = [];

  for (const item of items) {
    for (const account of item.accounts) {
      if (account.success) {
        accounts_updated++;

        // Track balance changes for event emission
        if (
          account.previous_balance !== undefined &&
          account.new_balance !== undefined &&
          account.previous_balance !== account.new_balance
        ) {
          balance_changes.push({
            account_id: account.account_id,
            previous: account.previous_balance,
            current: account.new_balance,
          });
        }
      } else {
        accounts_failed++;
      }
    }
  }

  // Overall success if at least one account updated OR no accounts needed updating
  const success = accounts_failed === 0 || accounts_updated > 0;

  return {
    success,
    accounts_updated,
    accounts_failed,
    items,
    balance_changes,
  };
}

/**
 * Determines if a balance change is significant enough to report.
 *
 * PURE FUNCTION.
 * Currently returns true for any change, but could be extended
 * to filter out minor changes if needed.
 */
export function is_significant_balance_change(
  previous: number,
  current: number,
  _threshold_percent = 0
): boolean {
  // Currently report all changes
  // Could add threshold logic: Math.abs(current - previous) / Math.abs(previous) > threshold_percent
  return previous !== current;
}
