/**
 * Refresh Plaid Data Domain Service
 *
 * PURE domain functions for aggregating balance and transaction
 * sync results into a unified response.
 *
 * These functions:
 * - Are PURE (no async, no IO, no side effects)
 * - Receive all data as input
 * - Return computed results
 *
 * @module domain/plaid/refresh_plaid_data
 */
import { BalanceSyncPhaseResult, TransactionSyncPhaseResult, RefreshPlaidDataResponse } from "../../types/plaid/refresh_plaid_data.types";
import { ClientAccountData } from "../../types/plaid/balance_sync.types";
/**
 * Aggregates results from balance sync and transaction sync phases.
 *
 * PURE FUNCTION - no IO, no side effects, deterministic.
 *
 * @param balance_result - Result from the balance sync phase
 * @param transaction_results - Results from transaction sync for each item
 * @param rate_limited_items - Items that were rate limited
 * @returns Unified response for the refresh operation
 */
export declare function aggregate_refresh_results(balance_result: BalanceSyncPhaseResult, transaction_results: TransactionSyncPhaseResult[], rate_limited_items?: string[]): RefreshPlaidDataResponse;
/**
 * Creates a failure response when the refresh operation cannot proceed.
 *
 * PURE FUNCTION.
 *
 * @param error_message - Description of the failure
 * @returns Response indicating failure
 */
export declare function create_refresh_failure_response(error_message: string): RefreshPlaidDataResponse;
/**
 * Creates a balance phase result from the sync_balances response.
 *
 * PURE FUNCTION.
 *
 * @param accounts - Updated accounts from balance sync
 * @param updated - Number of accounts updated
 * @param failed - Number of accounts that failed
 * @param balance_changes - Number of balance changes detected
 * @param errors - Any errors from balance sync
 * @returns Structured balance phase result
 */
export declare function create_balance_phase_result(accounts: ClientAccountData[], updated: number, failed: number, balance_changes: number, errors?: string[]): BalanceSyncPhaseResult;
/**
 * Creates a transaction phase result from the sync_transactions response.
 *
 * PURE FUNCTION.
 *
 * @param item_id - Plaid item ID
 * @param result - Result from transaction sync orchestrator
 * @returns Structured transaction phase result
 */
export declare function create_transaction_phase_result(item_id: string, result: {
    success: boolean;
    added_count: number;
    modified_count: number;
    removed_count: number;
    pending_migrated_count: number;
    error?: string;
}): TransactionSyncPhaseResult;
/**
 * Validates that the refresh operation should proceed.
 *
 * PURE FUNCTION.
 *
 * @param items_count - Number of items to sync
 * @param rate_limited_count - Number of rate limited items
 * @returns Validation result
 */
export declare function validate_refresh_request(items_count: number, rate_limited_count: number): {
    valid: boolean;
    error?: string;
};
//# sourceMappingURL=refresh_plaid_data.service.d.ts.map