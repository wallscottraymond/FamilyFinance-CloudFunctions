"use strict";
/**
 * Balance Sync Domain Service
 *
 * Pure business logic for balance synchronization.
 * NO async, NO IO, NO side effects.
 *
 * @module domain/plaid/balance_sync
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate_balance_updates = validate_balance_updates;
exports.create_account_success_result = create_account_success_result;
exports.create_account_failure_result = create_account_failure_result;
exports.create_item_success_result = create_item_success_result;
exports.create_item_failure_result = create_item_failure_result;
exports.aggregate_balance_sync_results = aggregate_balance_sync_results;
exports.is_significant_balance_change = is_significant_balance_change;
/**
 * Validates balance updates before applying.
 *
 * PURE FUNCTION - no IO, deterministic.
 * Currently a passthrough as we trust Plaid data.
 *
 * @param input - Balance updates to validate
 * @returns Domain result with validated updates
 */
function validate_balance_updates(input) {
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
function create_account_success_result(account_id, previous_balance, new_balance) {
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
function create_account_failure_result(account_id, error) {
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
function create_item_success_result(item_id, accounts) {
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
function create_item_failure_result(item_id, error) {
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
function aggregate_balance_sync_results(items) {
    let accounts_updated = 0;
    let accounts_failed = 0;
    const balance_changes = [];
    for (const item of items) {
        for (const account of item.accounts) {
            if (account.success) {
                accounts_updated++;
                // Track balance changes for event emission
                if (account.previous_balance !== undefined &&
                    account.new_balance !== undefined &&
                    account.previous_balance !== account.new_balance) {
                    balance_changes.push({
                        account_id: account.account_id,
                        previous: account.previous_balance,
                        current: account.new_balance,
                    });
                }
            }
            else {
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
function is_significant_balance_change(previous, current, _threshold_percent = 0) {
    // Currently report all changes
    // Could add threshold logic: Math.abs(current - previous) / Math.abs(previous) > threshold_percent
    return previous !== current;
}
//# sourceMappingURL=balance_sync.service.js.map