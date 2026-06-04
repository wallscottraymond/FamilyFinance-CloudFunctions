"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.aggregate_refresh_results = aggregate_refresh_results;
exports.create_refresh_failure_response = create_refresh_failure_response;
exports.create_balance_phase_result = create_balance_phase_result;
exports.create_transaction_phase_result = create_transaction_phase_result;
exports.validate_refresh_request = validate_refresh_request;
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
function aggregate_refresh_results(balance_result, transaction_results, rate_limited_items = []) {
    // Aggregate transaction stats
    const transactions_added = transaction_results.reduce((sum, r) => sum + r.added_count, 0);
    const transactions_modified = transaction_results.reduce((sum, r) => sum + r.modified_count, 0);
    const transactions_removed = transaction_results.reduce((sum, r) => sum + r.removed_count, 0);
    const pending_migrated = transaction_results.reduce((sum, r) => sum + r.pending_migrated_count, 0);
    // Count successful and failed transaction syncs
    const tx_successful = transaction_results.filter(r => r.success).length;
    const tx_failed = transaction_results.filter(r => !r.success).length;
    // Collect all errors
    const all_errors = [
        ...balance_result.errors,
        ...transaction_results
            .filter(r => r.error)
            .map(r => `[${r.item_id}] ${r.error}`),
    ];
    // Overall success if balance sync succeeded
    // (transaction failures are non-critical)
    const success = balance_result.success;
    return {
        success,
        // Balance results
        accounts: balance_result.accounts,
        accounts_updated: balance_result.accounts_updated,
        accounts_failed: balance_result.accounts_failed,
        balance_changes: balance_result.balance_changes,
        // Transaction results
        transactions_added,
        transactions_modified,
        transactions_removed,
        pending_migrated,
        // Overall stats
        items_synced: tx_successful,
        items_failed: tx_failed,
        items_rate_limited: rate_limited_items.length,
        // Errors if any
        errors: all_errors.length > 0 ? all_errors : undefined,
    };
}
/**
 * Creates a failure response when the refresh operation cannot proceed.
 *
 * PURE FUNCTION.
 *
 * @param error_message - Description of the failure
 * @returns Response indicating failure
 */
function create_refresh_failure_response(error_message) {
    return {
        success: false,
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
        items_rate_limited: 0,
        errors: [error_message],
    };
}
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
function create_balance_phase_result(accounts, updated, failed, balance_changes, errors = []) {
    return {
        success: errors.length === 0 || updated > 0,
        accounts,
        accounts_updated: updated,
        accounts_failed: failed,
        balance_changes,
        errors,
    };
}
/**
 * Creates a transaction phase result from the sync_transactions response.
 *
 * PURE FUNCTION.
 *
 * @param item_id - Plaid item ID
 * @param result - Result from transaction sync orchestrator
 * @returns Structured transaction phase result
 */
function create_transaction_phase_result(item_id, result) {
    return {
        success: result.success,
        item_id,
        added_count: result.added_count,
        modified_count: result.modified_count,
        removed_count: result.removed_count,
        pending_migrated_count: result.pending_migrated_count,
        error: result.error,
    };
}
/**
 * Validates that the refresh operation should proceed.
 *
 * PURE FUNCTION.
 *
 * @param items_count - Number of items to sync
 * @param rate_limited_count - Number of rate limited items
 * @returns Validation result
 */
function validate_refresh_request(items_count, rate_limited_count) {
    if (items_count === 0) {
        return {
            valid: false,
            error: "No Plaid items found to refresh",
        };
    }
    // Allow partial refresh even if some items are rate limited
    if (rate_limited_count === items_count) {
        return {
            valid: false,
            error: "All items are rate limited. Please wait before refreshing again.",
        };
    }
    return { valid: true };
}
//# sourceMappingURL=refresh_plaid_data.service.js.map