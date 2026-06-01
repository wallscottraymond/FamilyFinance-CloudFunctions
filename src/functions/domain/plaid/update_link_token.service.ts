/**
 * Update Link Token Domain Service
 *
 * Pure business logic for update link token validation.
 * NO async, NO IO, NO side effects - deterministic functions only.
 *
 * @module domain/plaid/update_link_token
 */

import {
  UpdateLinkTokenValidationInput,
  UpdateLinkTokenValidationResult,
  MAX_RELINK_ATTEMPTS_BEFORE_HELP,
  STATUSES_REQUIRING_REAUTH,
  STATUS_ERROR_MESSAGES,
} from "../../types/plaid/update_link_token.types";
import { PlaidItemStatus } from "../../types/plaid";

/**
 * Validates a request to create an update link token.
 *
 * Business rules validated:
 * 1. Item must exist
 * 2. User must own the item
 * 3. Item must be active
 * 4. Access token must be valid (decrypted successfully)
 * 5. Item status must allow re-link (not already healthy, not permanently broken)
 * 6. Checks for excessive re-link attempts
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param input - Validation input from resolver
 * @returns Validation result with errors or success
 */
export function validate_update_link_token_request(
  input: UpdateLinkTokenValidationInput
): UpdateLinkTokenValidationResult {
  const errors: string[] = [];
  let relink_disabled = false;
  let disabled_reason: string | null = null;

  // Rule 1: Item must exist
  if (!input.item_found) {
    errors.push("Bank connection not found");
    return { is_valid: false, errors, relink_disabled: false, disabled_reason: null };
  }

  // Rule 2: User must own the item
  if (!input.user_owns_item) {
    errors.push("You do not have permission to reconnect this bank");
    return { is_valid: false, errors, relink_disabled: false, disabled_reason: null };
  }

  // Rule 3: Item must be active
  if (!input.item_is_active) {
    errors.push("This bank connection has been removed");
    return { is_valid: false, errors, relink_disabled: false, disabled_reason: null };
  }

  // Rule 4: Access token must be valid
  if (!input.access_token_valid) {
    errors.push("Unable to access bank connection. Please try removing and re-adding the account.");
    return { is_valid: false, errors, relink_disabled: false, disabled_reason: null };
  }

  // Rule 5: Check item status for re-link eligibility
  const status_result = check_item_status_for_relink(input.item_status);
  if (status_result.relink_disabled) {
    relink_disabled = true;
    disabled_reason = status_result.disabled_reason;
    errors.push(status_result.disabled_reason || "Re-link is not available for this connection");
    return { is_valid: false, errors, relink_disabled, disabled_reason };
  }

  // Rule 6: Warn about excessive re-link attempts
  if (input.recent_relink_attempts >= MAX_RELINK_ATTEMPTS_BEFORE_HELP) {
    // Don't block, but include a warning for the orchestrator to handle
    // The orchestrator can add a help message to the response
  }

  // All validations passed
  return {
    is_valid: true,
    errors: [],
    relink_disabled: false,
    disabled_reason: null,
  };
}

/**
 * Checks if an item's status allows re-link.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param status - Current item status
 * @returns Whether re-link is allowed and reason if not
 */
export function check_item_status_for_relink(
  status: PlaidItemStatus | null
): { relink_disabled: boolean; disabled_reason: string | null } {
  // Null status (shouldn't happen) - allow re-link
  if (!status) {
    return { relink_disabled: false, disabled_reason: null };
  }

  // Item is healthy - technically doesn't need re-link
  // But we allow it anyway (proactive re-auth for pending_expiration)
  if (status === "good") {
    // Allow re-link for proactive refresh (user might want to update anyway)
    return { relink_disabled: false, disabled_reason: null };
  }

  // Check for statuses that require re-auth
  if (STATUSES_REQUIRING_REAUTH.includes(status)) {
    return { relink_disabled: false, disabled_reason: null };
  }

  // Check for special status messages
  if (STATUS_ERROR_MESSAGES[status]) {
    return {
      relink_disabled: true,
      disabled_reason: STATUS_ERROR_MESSAGES[status],
    };
  }

  // Unknown status - allow re-link (fail-open for user experience)
  return { relink_disabled: false, disabled_reason: null };
}

/**
 * Determines if user should see a help message based on failed attempts.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param recent_attempts - Number of recent re-link attempts
 * @returns Whether to show help message and what message
 */
export function should_show_help_message(
  recent_attempts: number
): { show_help: boolean; message: string | null } {
  if (recent_attempts >= MAX_RELINK_ATTEMPTS_BEFORE_HELP) {
    return {
      show_help: true,
      message:
        "Having trouble reconnecting? Try visiting your bank's website to verify your login credentials, " +
        "or contact your bank's support team if the issue persists.",
    };
  }

  return { show_help: false, message: null };
}

/**
 * Gets a user-friendly error message for update link token failures.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param error_code - The error code from Plaid or internal
 * @returns User-friendly error message
 */
export function get_update_link_token_error_message(error_code: string): string {
  // We intentionally return a generic message per project decisions.
  // This avoids exposing Plaid internals to users.
  return "Unable to prepare reconnection. Please try again later.";
}
