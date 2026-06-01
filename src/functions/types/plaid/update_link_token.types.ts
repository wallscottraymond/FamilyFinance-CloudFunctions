/**
 * Update Link Token Types
 *
 * Types for the create_update_link_token flow in the 5-layer architecture.
 * Used for re-authentication when Plaid connections enter error states.
 *
 * @module types/plaid/update_link_token
 */

import { Timestamp } from "firebase-admin/firestore";
import { PlaidItemStatus } from "./link_plaid_account.types";

// ============================================================================
// Input Types
// ============================================================================

/**
 * Input for creating an update link token.
 * Validated by Zod in the entry layer.
 */
export interface CreateUpdateLinkTokenInput {
  /** The Plaid item ID (document ID) to create update token for */
  item_id: string;

  /** Idempotency key to prevent duplicate requests */
  idempotency_key: string;
}

// ============================================================================
// Output Types
// ============================================================================

/**
 * Response from create_update_link_token.
 * Returned by orchestrator and entry layer.
 */
export interface CreateUpdateLinkTokenResponse {
  /** The Plaid link token for initializing Plaid Link in update mode */
  link_token: string;

  /** ISO timestamp when the token expires (4 hours from creation) */
  expiration: string;

  /** Institution name for display purposes */
  institution_name: string;

  /** Plaid request ID for debugging. */
  request_id: string;
}

// ============================================================================
// Resolver Types
// ============================================================================

/**
 * Input for resolving update link token dependencies.
 */
export interface ResolveUpdateLinkTokenInput {
  /** User ID requesting the update token */
  user_id: string;

  /** The Plaid item document ID */
  item_id: string;
}

/**
 * Dependencies resolved for update link token creation.
 * Gathered by resolver, used by orchestrator and domain service.
 */
export interface UpdateLinkTokenDependencies {
  /** The Plaid item entity */
  plaid_item: {
    /** Document ID */
    id: string;
    /** Plaid's item ID */
    plaid_item_id: string;
    /** User who owns this item */
    user_id: string;
    /** Institution ID */
    institution_id: string;
    /** Institution name for display */
    institution_name: string;
    /** Current status of the item */
    status: PlaidItemStatus;
    /** Error message if in error state */
    error: string | null;
    /** Whether the item is active */
    is_active: boolean;
  } | null;

  /** Decrypted access token (null if decryption failed) */
  access_token: string | null;

  /** Whether the item was found */
  item_found: boolean;

  /** Whether the user owns the item */
  user_owns_item: boolean;

  /** User's display name for Plaid */
  user_display_name: string;

  /** User's email for Plaid (optional) */
  user_email: string | null;

  /** Number of failed re-link attempts in the last 24 hours */
  recent_relink_attempts: number;
}

// ============================================================================
// Domain Service Types
// ============================================================================

/**
 * Input for validating an update link token request.
 * Used by the domain service (pure function).
 */
export interface UpdateLinkTokenValidationInput {
  /** User ID requesting the update token */
  user_id: string;

  /** Whether the item was found */
  item_found: boolean;

  /** Whether the user owns the item */
  user_owns_item: boolean;

  /** Whether the item is active */
  item_is_active: boolean;

  /** Current status of the item */
  item_status: PlaidItemStatus | null;

  /** Whether access token was decrypted successfully */
  access_token_valid: boolean;

  /** Number of recent re-link attempts */
  recent_relink_attempts: number;
}

/**
 * Result of update link token validation.
 */
export interface UpdateLinkTokenValidationResult {
  /** Whether the request is valid */
  is_valid: boolean;

  /** Validation error messages if any */
  errors: string[];

  /** Whether re-link should be disabled (e.g., ITEM_LOCKED) */
  relink_disabled: boolean;

  /** User-friendly message explaining why re-link is disabled */
  disabled_reason: string | null;
}

// ============================================================================
// Repository Types
// ============================================================================

/**
 * Relink attempt record stored in Firestore for tracking.
 */
export interface RelinkAttempt {
  /** Document ID */
  id: string;

  /** User who initiated the relink */
  user_id: string;

  /** Plaid item ID */
  item_id: string;

  /** Error code that triggered re-link */
  error_code: string | null;

  /** Trace ID for debugging */
  trace_id: string;

  /** Whether the re-link was successful */
  success: boolean | null;

  /** When this attempt was created */
  created_at: Timestamp;

  /** When this attempt was completed (success or failure) */
  completed_at: Timestamp | null;
}

/**
 * Input for logging a relink attempt.
 */
export type RelinkAttemptInput = Omit<RelinkAttempt, "id" | "created_at" | "completed_at">;

// ============================================================================
// Orchestrator Types
// ============================================================================

/**
 * Result type for the create_update_link_token orchestrator.
 */
export interface CreateUpdateLinkTokenOrchestratorResult {
  /** Whether the operation succeeded */
  success: boolean;

  /** The response data (on success) */
  data?: CreateUpdateLinkTokenResponse;

  /** Validation errors (on failure) */
  errors?: string[];

  /** Whether re-link is disabled (e.g., ITEM_LOCKED) */
  relink_disabled?: boolean;

  /** User-friendly reason for disabled state */
  disabled_reason?: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum number of re-link attempts before showing help message.
 */
export const MAX_RELINK_ATTEMPTS_BEFORE_HELP = 3;

/**
 * Time window for counting recent re-link attempts (hours).
 */
export const RELINK_ATTEMPT_WINDOW_HOURS = 24;

/**
 * Retention period for relink attempt records (days).
 */
export const RELINK_ATTEMPT_RETENTION_DAYS = 30;

/**
 * Performance budget for create_update_link_token orchestrator.
 */
export const CREATE_UPDATE_LINK_TOKEN_BUDGET = {
  max_reads: 5,
  max_writes: 1,
  max_time_ms: 5000,
};

/**
 * Plaid item statuses that require re-authentication.
 */
export const STATUSES_REQUIRING_REAUTH: PlaidItemStatus[] = [
  "item_login_required",
  "pending_expiration",
];

/**
 * Error messages for specific item statuses.
 */
export const STATUS_ERROR_MESSAGES: Record<string, string> = {
  /* eslint-disable @typescript-eslint/naming-convention */
  item_locked:
    "Your account is locked. Please visit your bank's website to unlock it, then try reconnecting here.",
  good:
    "This connection is healthy and does not require re-authentication.",
  /* eslint-enable @typescript-eslint/naming-convention */
};
