/**
 * Link Token Types
 *
 * Types for the create_link_token flow in the 5-layer architecture.
 *
 * @module types/plaid/link_token
 */

import { Timestamp } from "firebase-admin/firestore";

// ============================================================================
// Input Types
// ============================================================================

/**
 * Input for creating a link token.
 * Validated by Zod in the entry layer.
 */
export interface CreateLinkTokenInput {
  /** Access token for update mode (re-authentication). Optional. */
  access_token?: string;

  /** Redirect URI for OAuth flows. Optional. */
  redirect_uri?: string;
}

// ============================================================================
// Output Types
// ============================================================================

/**
 * Response from create_link_token.
 * Returned by orchestrator and entry layer.
 */
export interface CreateLinkTokenResponse {
  /** The Plaid link token for initializing Plaid Link */
  link_token: string;

  /** ISO timestamp when the token expires (4 hours from creation) */
  expiration: string;

  /** Plaid request ID for debugging. 'cached' if returned from cache. */
  request_id: string;
}

// ============================================================================
// Resolver Types
// ============================================================================

/**
 * Dependencies resolved for link token creation.
 * Gathered by resolver, used by orchestrator and domain service.
 */
export interface LinkTokenDependencies {
  /** User's display name for Plaid (fallback: 'Family Finance User') */
  user_display_name: string;

  /** User's email for Plaid (optional) */
  user_email: string | null;

  /** Number of existing Plaid items for this user (for future limits) */
  existing_item_count: number;

  /** Whether the provided access_token is valid (for update mode) */
  access_token_valid: boolean;

  /** Cached link token if available and not expired */
  cached_token: string | null;

  /** Cached token expiration if available */
  cached_expiration: string | null;
}

/**
 * Input for resolving link token dependencies.
 */
export interface ResolveLinkTokenInput {
  /** User ID to resolve dependencies for */
  user_id: string;

  /** Access token for update mode validation */
  access_token?: string;

  /** Whether this is an update mode request */
  is_update_mode: boolean;
}

// ============================================================================
// Domain Service Types
// ============================================================================

/**
 * Input for validating a link token request.
 * Used by the domain service (pure function).
 */
export interface LinkTokenValidationInput {
  /** User ID requesting the link token */
  user_id: string;

  /** Number of existing Plaid items for account limit checks */
  existing_item_count: number;

  /** Whether this is an update mode (re-authentication) request */
  is_update_mode: boolean;

  /** Whether the access_token is valid (for update mode) */
  access_token_valid?: boolean;
}

// ============================================================================
// Integration Client Types
// ============================================================================

/**
 * Input for calling Plaid's linkTokenCreate API.
 */
export interface PlaidCreateLinkTokenInput {
  /** User ID for Plaid's client_user_id */
  user_id: string;

  /** User's name for Plaid's legal_name */
  user_name: string;

  /** User's email for Plaid (optional) */
  user_email: string | null;

  /** Access token for update mode (re-authentication) */
  access_token?: string;
}

// ============================================================================
// Repository Types
// ============================================================================

/**
 * Link token event stored in Firestore for audit and caching.
 */
export interface LinkTokenEvent {
  /** Document ID */
  id: string;

  /** User who requested the link token */
  user_id: string;

  /** Plaid request ID (or 'cached' for cache hits) */
  request_id: string;

  /** Whether this was an update mode (re-auth) request */
  is_update_mode: boolean;

  /** Trace ID for debugging */
  trace_id: string;

  /** The link token (stored for caching) */
  link_token: string;

  /** Token expiration (stored for caching) */
  expiration: string;

  /** When this event was created */
  created_at: Timestamp;
}

/**
 * Input for logging a link token creation event.
 * Excludes auto-generated fields (id, created_at).
 */
export type LinkTokenEventInput = Omit<LinkTokenEvent, "id" | "created_at">;

/**
 * Options for retrieving a valid cached token.
 */
export interface GetValidTokenOptions {
  /** Maximum age in hours for the cached token */
  max_age_hours: number;
}

// ============================================================================
// Orchestrator Types
// ============================================================================

/**
 * Result type for the create_link_token orchestrator.
 */
export interface CreateLinkTokenOrchestratorResult {
  /** Whether the operation succeeded */
  success: boolean;

  /** The response data (on success) */
  data?: CreateLinkTokenResponse;

  /** Validation errors (on failure) */
  errors?: string[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Cache TTL for link tokens in hours.
 * Tokens are valid for 4 hours; we cache for 3 to ensure validity.
 */
export const LINK_TOKEN_CACHE_TTL_HOURS = 3;

/**
 * Performance budget for create_link_token orchestrator.
 */
export const CREATE_LINK_TOKEN_BUDGET = {
  max_reads: 5,
  max_writes: 1,
  max_time_ms: 5000,
};
