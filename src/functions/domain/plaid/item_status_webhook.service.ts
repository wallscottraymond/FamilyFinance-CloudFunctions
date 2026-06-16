/**
 * Item Status Webhook Domain Service
 *
 * Pure business logic for processing item status webhooks.
 * NO async, NO IO, NO side effects - deterministic functions only.
 *
 * @module domain/plaid/item_status_webhook
 */

import { Timestamp } from "firebase-admin/firestore";
import {
  ItemStatusUpdate,
  ItemStatusValues,
  REAUTH_ERROR_CODES,
  TRANSIENT_ERROR_CODES,
  RATE_LIMIT_ERROR_CODES,
  ERROR_CODE_MESSAGES,
} from "../../types/plaid/item_status_webhook.types";

/**
 * Whether an error code is a transient/rate-limit failure that should be
 * retried silently rather than surfaced to the user. PURE.
 */
export function is_transient_error_code(error_code: string): boolean {
  return (
    TRANSIENT_ERROR_CODES.includes(error_code) ||
    RATE_LIMIT_ERROR_CODES.includes(error_code)
  );
}

/**
 * Computes the status update for a PENDING_EXPIRATION webhook.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param consent_expiration_time - ISO timestamp when consent expires
 * @returns Status update to apply
 */
export function compute_pending_expiration_update(
  now: Timestamp,
  consent_expiration_time?: string
): ItemStatusUpdate {
  let consent_expires_at: Timestamp | null = null;

  if (consent_expiration_time) {
    try {
      const expiration_date = new Date(consent_expiration_time);
      consent_expires_at = Timestamp.fromDate(expiration_date);
    } catch {
      // Invalid date format - ignore
    }
  }

  return {
    status: ItemStatusValues.PENDING_EXPIRATION,
    error_code: "PENDING_EXPIRATION",
    error_message: ERROR_CODE_MESSAGES.PENDING_EXPIRATION,
    error_at: now,
    requires_reauth: true,
    consent_expires_at,
    is_transient: false,
  };
}

/**
 * Computes the status update for an ERROR webhook.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param error_code - The Plaid error code
 * @param error_message - The Plaid error message
 * @returns Status update to apply
 */
export function compute_error_update(
  now: Timestamp,
  error_code: string,
  error_message?: string
): ItemStatusUpdate {
  const user_message = ERROR_CODE_MESSAGES[error_code] ||
    error_message ||
    "There was an issue with your bank connection. Please try reconnecting.";

  // Transient failures (institution down, rate limited, internal error) are NOT
  // the user's fault and recover on their own. Mark them silent so the
  // auto-retry job handles them in the background instead of surfacing a
  // "Reconnect" prompt immediately.
  if (RATE_LIMIT_ERROR_CODES.includes(error_code)) {
    return {
      status: ItemStatusValues.RATE_LIMITED,
      error_code,
      error_message: user_message,
      error_at: now,
      requires_reauth: false,
      consent_expires_at: null,
      is_transient: true,
    };
  }
  if (TRANSIENT_ERROR_CODES.includes(error_code)) {
    return {
      status: ItemStatusValues.TEMPORARY_ERROR,
      error_code,
      error_message: user_message,
      error_at: now,
      requires_reauth: false,
      consent_expires_at: null,
      is_transient: true,
    };
  }

  // Everything else is treated as requiring re-authentication and is surfaced
  // to the user immediately.
  const requires_reauth = REAUTH_ERROR_CODES.includes(error_code);
  return {
    status: ItemStatusValues.ITEM_LOGIN_REQUIRED,
    error_code,
    error_message: user_message,
    error_at: now,
    requires_reauth,
    consent_expires_at: null,
    is_transient: false,
  };
}

/**
 * Computes the status update for a LOGIN_REPAIRED webhook.
 * This clears the error state and sets status back to healthy.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @returns Status update to apply
 */
export function compute_login_repaired_update(): ItemStatusUpdate {
  return {
    status: ItemStatusValues.HEALTHY,
    error_code: null,
    error_message: null,
    error_at: null,
    requires_reauth: false,
    consent_expires_at: null,
    is_transient: false,
  };
}

/**
 * Computes the status update that ESCALATES a transient error to the user after
 * it has persisted past the surface threshold. The connection has been failing
 * silently for too long, so we surface it as needing a reconnect (reusing the
 * existing reauth UI — update mode is the available user action).
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param original_error_code - The transient error code that persisted
 * @returns Status update to apply
 */
export function compute_escalation_update(
  now: Timestamp,
  original_error_code: string | null
): ItemStatusUpdate {
  return {
    status: ItemStatusValues.ITEM_LOGIN_REQUIRED,
    error_code: original_error_code ?? "PERSISTENT_CONNECTION_ERROR",
    error_message: ERROR_CODE_MESSAGES.PERSISTENT_CONNECTION_ERROR,
    error_at: now,
    requires_reauth: true,
    consent_expires_at: null,
    is_transient: false,
  };
}

/**
 * Computes the status update for a USER_PERMISSION_REVOKED webhook.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @returns Status update to apply
 */
export function compute_permission_revoked_update(now: Timestamp): ItemStatusUpdate {
  return {
    status: ItemStatusValues.USER_PERMISSION_REVOKED,
    error_code: "USER_PERMISSION_REVOKED",
    error_message: ERROR_CODE_MESSAGES.USER_PERMISSION_REVOKED,
    error_at: now,
    requires_reauth: false, // Can't re-auth if permission is revoked
    consent_expires_at: null,
    is_transient: false,
  };
}

/**
 * Determines if a status change should trigger a data refresh.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param previous_status - The previous item status
 * @param new_status - The new item status
 * @returns Whether to trigger a data refresh
 */
export function should_trigger_refresh(
  previous_status: string | null,
  new_status: string
): boolean {
  // Only trigger refresh when connection is repaired
  if (new_status !== ItemStatusValues.HEALTHY) {
    return false;
  }

  // Trigger refresh if coming from an error state
  const error_statuses = [
    ItemStatusValues.ITEM_LOGIN_REQUIRED,
    ItemStatusValues.PENDING_EXPIRATION,
  ];

  return previous_status !== null && error_statuses.includes(previous_status as typeof error_statuses[number]);
}

/**
 * Gets the webhook code that should mark a relink attempt as successful.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param webhook_code - The webhook code received
 * @returns Whether this webhook indicates a successful relink
 */
export function is_successful_relink_webhook(webhook_code: string): boolean {
  return webhook_code === "LOGIN_REPAIRED";
}
