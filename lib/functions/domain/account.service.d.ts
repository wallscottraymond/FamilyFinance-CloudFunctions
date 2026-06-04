/**
 * Account Domain Service
 *
 * Pure business logic for account operations.
 * NO async, NO IO, NO side effects - deterministic functions only.
 *
 * @module domain/account
 */
import { DomainResult } from "../types";
/**
 * Account data needed for permission checks.
 * Minimal interface to avoid coupling to full Account entity.
 */
export interface AccountAccessData {
    user_id: string;
    is_active: boolean;
    is_deleted?: boolean;
    access: {
        owner_id: string;
        group_ids: string[];
        is_private: boolean;
    };
}
/**
 * User context for permission checks.
 */
export interface UserAccessContext {
    user_id: string;
    group_ids: string[];
}
/**
 * Result of an access check.
 */
export interface AccessCheckResult {
    has_access: boolean;
    reason?: string;
}
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
export declare function check_account_read_access(account: AccountAccessData, user: UserAccessContext): DomainResult<AccessCheckResult>;
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
export declare function check_account_write_access(account: AccountAccessData, user: UserAccessContext): DomainResult<AccessCheckResult>;
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
export declare function check_account_delete_access(account: AccountAccessData, user: UserAccessContext): DomainResult<AccessCheckResult>;
/**
 * Determines if an account removal is idempotent.
 * Returns true if the account is already in a deleted state.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param account - Account access data
 * @returns Whether removal would be a no-op
 */
export declare function is_account_already_deleted(account: AccountAccessData): boolean;
/**
 * How to handle transaction history when removing an account.
 */
export type RemovalMode = "keep_history" | "delete_history";
/**
 * Type of removal operation.
 * - single_account: Remove one account, item stays active (local only)
 * - full_item: Remove last account, call Plaid API to disconnect item
 */
export type RemovalType = "single_account" | "full_item";
/**
 * Input for determining removal type.
 */
export interface DetermineRemovalTypeInput {
    /** Account being removed */
    account_id: string;
    /** Plaid item ID associated with the account */
    item_id: string;
    /** Count of OTHER active accounts for this item (excluding the one being removed) */
    other_active_accounts_count: number;
}
/**
 * Result of determining removal type.
 */
export interface RemovalTypeResult {
    /** Type of removal to perform */
    removal_type: RemovalType;
    /** Whether Plaid API should be called */
    should_call_plaid: boolean;
    /** Reason for the determination */
    reason: string;
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
export declare function determine_removal_type(input: DetermineRemovalTypeInput): DomainResult<RemovalTypeResult>;
/**
 * Input for computing account removal.
 */
export interface ComputeAccountRemovalInput {
    /** Account ID being removed */
    account_id: string;
    /** User ID of the account owner */
    account_user_id: string;
    /** Plaid item ID (if linked via Plaid) */
    item_id: string | null;
    /** How to handle transaction history */
    removal_mode: RemovalMode;
    /** Type of removal (single account vs full item) */
    removal_type: RemovalType;
    /** Current timestamp for setting removal time */
    now: Date;
}
/**
 * Account state after removal computation.
 * These fields should be set on the account document.
 */
export interface AccountRemovalState {
    /** Account ID */
    account_id: string;
    /** Set to false (soft-delete) */
    is_active: false;
    /** How history was handled */
    removal_mode: RemovalMode;
    /** When the account was removed */
    removed_at: Date;
    /** Whether this account can be restored */
    is_restorable: boolean;
}
/**
 * Result of computing account removal.
 */
export interface AccountRemovalResult {
    /** State to apply to the account */
    account_state: AccountRemovalState;
    /** Whether to call Plaid API to remove the item */
    should_remove_plaid_item: boolean;
    /** Whether to process cascade (transactions, recurring items) */
    should_cascade: boolean;
    /** Whether transactions should be excluded from budgets */
    exclude_transactions_from_budgets: boolean;
}
/**
 * Computes the account removal state and determines what actions to take.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param input - Account removal input
 * @returns Account removal result
 */
export declare function compute_account_removal(input: ComputeAccountRemovalInput): DomainResult<AccountRemovalResult>;
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
export declare function validate_account_restore(account_is_active: boolean, account_is_restorable: boolean, item_is_active: boolean | null): DomainResult<{
    can_restore: boolean;
    reason: string;
}>;
//# sourceMappingURL=account.service.d.ts.map