/**
 * Balance Sync Domain Service
 *
 * Pure business logic for balance synchronization.
 * NO async, NO IO, NO side effects.
 *
 * @module domain/plaid/balance_sync
 */
import { DomainResult } from "../../types";
import { BalanceUpdate, BalanceValidationInput, BalanceSyncAccountResult, BalanceSyncItemResult, BalanceSyncAggregatedResult } from "../../types/plaid";
/**
 * Validates balance updates before applying.
 *
 * PURE FUNCTION - no IO, deterministic.
 * Currently a passthrough as we trust Plaid data.
 *
 * @param input - Balance updates to validate
 * @returns Domain result with validated updates
 */
export declare function validate_balance_updates(input: BalanceValidationInput): DomainResult<BalanceUpdate>;
/**
 * Creates a success result for a single account balance update.
 *
 * PURE FUNCTION.
 */
export declare function create_account_success_result(account_id: string, previous_balance: number, new_balance: number): BalanceSyncAccountResult;
/**
 * Creates a failure result for a single account balance update.
 *
 * PURE FUNCTION.
 */
export declare function create_account_failure_result(account_id: string, error: string): BalanceSyncAccountResult;
/**
 * Creates a success result for a Plaid item sync.
 *
 * PURE FUNCTION.
 */
export declare function create_item_success_result(item_id: string, accounts: BalanceSyncAccountResult[]): BalanceSyncItemResult;
/**
 * Creates a failure result for a Plaid item sync.
 *
 * PURE FUNCTION.
 */
export declare function create_item_failure_result(item_id: string, error: string): BalanceSyncItemResult;
/**
 * Aggregates item results into a partial response.
 * The orchestrator adds `accounts` field after calling this.
 *
 * PURE FUNCTION.
 */
export declare function aggregate_balance_sync_results(items: BalanceSyncItemResult[]): BalanceSyncAggregatedResult;
/**
 * Determines if a balance change is significant enough to report.
 *
 * PURE FUNCTION.
 * Currently returns true for any change, but could be extended
 * to filter out minor changes if needed.
 */
export declare function is_significant_balance_change(previous: number, current: number, _threshold_percent?: number): boolean;
//# sourceMappingURL=balance_sync.service.d.ts.map