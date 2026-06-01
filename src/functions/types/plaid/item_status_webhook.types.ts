/**
 * Item Status Webhook Types
 *
 * Types for handling Plaid ITEM webhook events that affect item status.
 * Includes PENDING_EXPIRATION, ERROR, and LOGIN_REPAIRED webhooks.
 *
 * @module types/plaid/item_status_webhook
 */

import { Timestamp } from "firebase-admin/firestore";

// ============================================================================
// Input Types
// ============================================================================

/**
 * Input for item status webhook orchestrators.
 */
export interface ItemStatusWebhookInput {
  /** Plaid's item ID (not our document ID) */
  plaid_item_id: string;

  /** The webhook type (always "ITEM" for these) */
  webhook_type: string;

  /** The specific webhook code */
  webhook_code: string;

  /** Plaid request ID for debugging */
  request_id?: string;

  /** Consent expiration date (for PENDING_EXPIRATION) */
  consent_expiration_time?: string;

  /** Error details (for ERROR webhook) */
  error?: {
    error_type: string;
    error_code: string;
    error_message: string;
    display_message: string | null;
  };
}

// ============================================================================
// Output Types
// ============================================================================

/**
 * Response from item status webhook orchestrators.
 */
export interface ItemStatusWebhookResponse {
  /** Whether the webhook was processed successfully */
  success: boolean;

  /** Whether the webhook was skipped (e.g., item not found) */
  skipped: boolean;

  /** Reason for skipping if skipped */
  skip_reason?: string;

  /** Error message if failed */
  error?: string;

  /** The document ID of the affected item */
  item_doc_id?: string;

  /** The previous status before update */
  previous_status?: string;

  /** The new status after update */
  new_status?: string;

  /** Whether a data refresh was triggered (for LOGIN_REPAIRED) */
  refresh_triggered?: boolean;
}

// ============================================================================
// Resolver Types
// ============================================================================

/**
 * Input for resolving item status webhook dependencies.
 */
export interface ResolveItemStatusWebhookInput {
  /** Plaid's item ID */
  plaid_item_id: string;
}

/**
 * Dependencies resolved for item status webhooks.
 */
export interface ItemStatusWebhookDependencies {
  /** Whether the item was found */
  item_found: boolean;

  /** The item's document ID */
  item_doc_id: string | null;

  /** The item's user ID */
  user_id: string | null;

  /** Current item status */
  current_status: string | null;

  /** Whether the item is active */
  is_active: boolean;

  /** Institution name for logging */
  institution_name: string | null;
}

// ============================================================================
// Domain Types
// ============================================================================

/**
 * Item status update to apply.
 */
export interface ItemStatusUpdate {
  /** New status value */
  status: string;

  /** Error code if applicable */
  error_code: string | null;

  /** User-friendly error message */
  error_message: string | null;

  /** When the error occurred */
  error_at: Timestamp | null;

  /** Whether re-authentication is required */
  requires_reauth: boolean;

  /** Consent expiration time (for PENDING_EXPIRATION) */
  consent_expires_at: Timestamp | null;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Performance budget for item status webhook orchestrators.
 */
export const ITEM_STATUS_WEBHOOK_BUDGET = {
  max_reads: 3,
  max_writes: 2,
  max_time_ms: 5000,
};

/**
 * Item status values used by the webhook handlers.
 */
export const ItemStatusValues = {
  /** Connection is healthy */
  HEALTHY: "good",
  /** Re-authentication required */
  ITEM_LOGIN_REQUIRED: "item_login_required",
  /** OAuth consent expiring soon */
  PENDING_EXPIRATION: "pending_expiration",
  /** User revoked access */
  USER_PERMISSION_REVOKED: "user_permission_revoked",
  /** Item was removed */
  REMOVED: "removed",
} as const;

/**
 * Error codes that require re-authentication.
 */
export const REAUTH_ERROR_CODES = [
  "ITEM_LOGIN_REQUIRED",
  "INVALID_CREDENTIALS",
  "INVALID_MFA",
  "USER_SETUP_REQUIRED",
  "MFA_NOT_SUPPORTED",
  "NO_ACCOUNTS",
  "ITEM_NOT_SUPPORTED",
];

/**
 * User-friendly error messages for different error codes.
 */
export const ERROR_CODE_MESSAGES: Record<string, string> = {
  /* eslint-disable @typescript-eslint/naming-convention */
  ITEM_LOGIN_REQUIRED: "Your bank requires you to verify your identity. Please reconnect your account.",
  INVALID_CREDENTIALS: "Your login credentials have changed. Please reconnect your account.",
  ITEM_LOCKED: "Your account is locked. Please visit your bank's website to unlock it, then reconnect here.",
  PENDING_EXPIRATION: "Your bank connection will expire soon. Please reconnect to maintain access.",
  USER_PERMISSION_REVOKED: "You have revoked access to this bank connection.",
  /* eslint-enable @typescript-eslint/naming-convention */
};
