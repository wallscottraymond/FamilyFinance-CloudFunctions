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
export function check_account_read_access(
  account: AccountAccessData,
  user: UserAccessContext
): DomainResult<AccessCheckResult> {
  // Owner always has access
  if (account.user_id === user.user_id) {
    return {
      entity: { has_access: true, reason: "owner" },
    };
  }

  // Check group-based access (if not private)
  if (!account.access.is_private) {
    const shared_groups = account.access.group_ids.filter(
      group_id => user.group_ids.includes(group_id)
    );

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
export function check_account_write_access(
  account: AccountAccessData,
  user: UserAccessContext
): DomainResult<AccessCheckResult> {
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
export function check_account_delete_access(
  account: AccountAccessData,
  user: UserAccessContext
): DomainResult<AccessCheckResult> {
  const validation_errors: string[] = [];

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
export function is_account_already_deleted(account: AccountAccessData): boolean {
  return !account.is_active || account.is_deleted === true;
}

// ============================================================================
// ACCOUNT REMOVAL DOMAIN LOGIC
// ============================================================================

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
export function determine_removal_type(
  input: DetermineRemovalTypeInput
): DomainResult<RemovalTypeResult> {
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
export function compute_account_removal(
  input: ComputeAccountRemovalInput
): DomainResult<AccountRemovalResult> {
  // Validate input
  const validation_errors: string[] = [];

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
  const account_state: AccountRemovalState = {
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
export function validate_account_restore(
  account_is_active: boolean,
  account_is_restorable: boolean,
  item_is_active: boolean | null
): DomainResult<{ can_restore: boolean; reason: string }> {
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
