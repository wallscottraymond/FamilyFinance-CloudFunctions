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
  ERROR_CODE_MESSAGES,
} from "../../types/plaid/item_status_webhook.types";

/**
 * Computes the status update for a PENDING_EXPIRATION webhook.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param consent_expiration_time - ISO timestamp when consent expires
 * @returns Status update to apply
 */
export function compute_pending_expiration_update(
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
    error_at: Timestamp.now(),
    requires_reauth: true,
    consent_expires_at,
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
  error_code: string,
  error_message?: string
): ItemStatusUpdate {
  const requires_reauth = REAUTH_ERROR_CODES.includes(error_code);

  // Map error code to status
  let status: string;
  if (error_code === "ITEM_LOGIN_REQUIRED" || requires_reauth) {
    status = ItemStatusValues.ITEM_LOGIN_REQUIRED;
  } else {
    status = ItemStatusValues.ITEM_LOGIN_REQUIRED; // Default to reauth required
  }

  // Get user-friendly message
  const user_message = ERROR_CODE_MESSAGES[error_code] ||
    error_message ||
    "There was an issue with your bank connection. Please try reconnecting.";

  return {
    status,
    error_code,
    error_message: user_message,
    error_at: Timestamp.now(),
    requires_reauth,
    consent_expires_at: null,
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
  };
}

/**
 * Computes the status update for a USER_PERMISSION_REVOKED webhook.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @returns Status update to apply
 */
export function compute_permission_revoked_update(): ItemStatusUpdate {
  return {
    status: ItemStatusValues.USER_PERMISSION_REVOKED,
    error_code: "USER_PERMISSION_REVOKED",
    error_message: ERROR_CODE_MESSAGES.USER_PERMISSION_REVOKED,
    error_at: Timestamp.now(),
    requires_reauth: false, // Can't re-auth if permission is revoked
    consent_expires_at: null,
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
