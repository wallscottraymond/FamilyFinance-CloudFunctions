"use strict";
/**
 * Account Domain Service
 *
 * Pure business logic for account operations.
 * NO async, NO IO, NO side effects - deterministic functions only.
 *
 * @module domain/account
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.check_account_read_access = check_account_read_access;
exports.check_account_write_access = check_account_write_access;
exports.check_account_delete_access = check_account_delete_access;
exports.is_account_already_deleted = is_account_already_deleted;
exports.determine_removal_type = determine_removal_type;
exports.compute_account_removal = compute_account_removal;
exports.validate_account_restore = validate_account_restore;
/**
 * Checks if a user has read access to an account.
 *
 * Access is granted if:
 * 1. User is the owner (user_id matches)
 * 2. User shares a group with the account (group_ids overlap)
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param account - Account access data
 * @param user - User context
 * @returns Access check result
 */
function check_account_read_access(account, user) {
    // Owner always has access
    if (account.user_id === user.user_id) {
        return {
            entity: { has_access: true, reason: "owner" },
        };
    }
    // Check group-based access (if not private)
    if (!account.access.is_private) {
        const shared_groups = account.access.group_ids.filter(group_id => user.group_ids.includes(group_id));
        if (shared_groups.length > 0) {
            return {
                entity: { has_access: true, reason: "group_member" },
            };
        }
    }
    // No access
    return {
        entity: { has_access: false, reason: "not_authorized" },
    };
}
/**
 * Checks if a user has write access to an account.
 *
 * Write access requires:
 * 1. User must be the owner (only owners can modify accounts)
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param account - Account access data
 * @param user - User context
 * @returns Access check result
 */
function check_account_write_access(account, user) {
    // Only owner can write
    if (account.user_id === user.user_id) {
        return {
            entity: { has_access: true, reason: "owner" },
        };
    }
    return {
        entity: { has_access: false, reason: "not_owner" },
    };
}
/**
 * Checks if a user can delete an account.
 *
 * Delete access requires:
 * 1. User must be the owner
 * 2. Account must not already be deleted
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param account - Account access data
 * @param user - User context
 * @returns Access check result with validation errors if applicable
 */
function check_account_delete_access(account, user) {
    const validation_errors = [];
    // Check ownership
    if (account.user_id !== user.user_id) {
        return {
            entity: { has_access: false, reason: "not_owner" },
            validation_errors: ["Only the account owner can delete this account"],
        };
    }
    // Check if already deleted
    if (account.is_deleted || !account.is_active) {
        return {
            entity: { has_access: true, reason: "already_deleted" },
        };
    }
    if (validation_errors.length > 0) {
        return {
            entity: { has_access: false },
            validation_errors,
        };
    }
    return {
        entity: { has_access: true, reason: "owner" },
    };
}
/**
 * Determines if an account removal is idempotent.
 * Returns true if the account is already in a deleted state.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param account - Account access data
 * @returns Whether removal would be a no-op
 */
function is_account_already_deleted(account) {
    return !account.is_active || account.is_deleted === true;
}
/**
 * Determines whether this is a single account removal or full item removal.
 *
 * Logic:
 * - If other active accounts exist for the same item → single_account
 * - If this is the last/only account for the item → full_item
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param input - Removal type determination input
 * @returns Removal type result
 */
function determine_removal_type(input) {
    // Validate input
    if (!input.account_id) {
        return { validation_errors: ["account_id is required"] };
    }
    if (!input.item_id) {
        return { validation_errors: ["item_id is required"] };
    }
    if (input.other_active_accounts_count < 0) {
        return { validation_errors: ["other_active_accounts_count cannot be negative"] };
    }
    // If there are other active accounts, this is a single account removal
    if (input.other_active_accounts_count > 0) {
        return {
            entity: {
                removal_type: "single_account",
                should_call_plaid: false,
                reason: `Item has ${input.other_active_accounts_count} other active account(s), keeping Plaid connection`,
            },
        };
    }
    // This is the last account - full item removal
    return {
        entity: {
            removal_type: "full_item",
            should_call_plaid: true,
            reason: "Last account for item, will disconnect from Plaid",
        },
    };
}
/**
 * Computes the account removal state and determines what actions to take.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param input - Account removal input
 * @returns Account removal result
 */
function compute_account_removal(input) {
    // Validate input
    const validation_errors = [];
    if (!input.account_id) {
        validation_errors.push("account_id is required");
    }
    if (!input.account_user_id) {
        validation_errors.push("account_user_id is required");
    }
    if (!input.removal_mode) {
        validation_errors.push("removal_mode is required");
    }
    if (!input.removal_type) {
        validation_errors.push("removal_type is required");
    }
    if (validation_errors.length > 0) {
        return { validation_errors };
    }
    // Compute the account state
    const account_state = {
        account_id: input.account_id,
        is_active: false,
        removal_mode: input.removal_mode,
        removed_at: input.now,
        // Can only restore if the item is still active (single_account removal)
        is_restorable: input.removal_type === "single_account",
    };
    // Determine actions based on removal type and mode
    const should_remove_plaid_item = input.removal_type === "full_item" && input.item_id !== null;
    const exclude_transactions_from_budgets = input.removal_mode === "delete_history";
    return {
        entity: {
            account_state,
            should_remove_plaid_item,
            should_cascade: true, // Always cascade to hide transactions and soft-delete recurring
            exclude_transactions_from_budgets,
        },
    };
}
/**
 * Validates that an account can be restored.
 *
 * Restoration is allowed if:
 * 1. Account is currently inactive (was removed)
 * 2. Account is marked as restorable (was a single account removal)
 * 3. The Plaid item is still active
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param account_is_active - Current account active state
 * @param account_is_restorable - Whether account was marked as restorable
 * @param item_is_active - Whether the Plaid item is still active (null if no item)
 * @returns Validation result
 */
function validate_account_restore(account_is_active, account_is_restorable, item_is_active) {
    // Account must be inactive
    if (account_is_active) {
        return {
            entity: { can_restore: false, reason: "Account is already active" },
        };
    }
    // Account must be marked as restorable
    if (!account_is_restorable) {
        return {
            entity: {
                can_restore: false,
                reason: "Account was fully removed (item disconnected from Plaid)",
            },
        };
    }
    // If linked to Plaid, item must be active
    if (item_is_active === false) {
        return {
            entity: {
                can_restore: false,
                reason: "Plaid item is no longer active - cannot restore",
            },
        };
    }
    return {
        entity: { can_restore: true, reason: "Account can be restored" },
    };
}
//# sourceMappingURL=account.service.js.map