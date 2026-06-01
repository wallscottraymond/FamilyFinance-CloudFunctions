/**
 * Link Plaid Account Types
 *
 * Types for the link_plaid_account flow in the 5-layer architecture.
 * This combines the full Plaid Link flow:
 * 1. Exchange public token for access token
 * 2. Save Plaid item
 * 3. Link accounts
 *
 * @module types/plaid/link_plaid_account
 */

import { Timestamp } from "firebase-admin/firestore";

// ============================================================================
// Input Types
// ============================================================================

/**
 * Input for linking a Plaid account (full flow).
 * Validated by Zod in the entry layer.
 */
export interface LinkPlaidAccountInput {
  /** The public token from Plaid Link */
  public_token: string;

  /** Institution ID from Plaid Link metadata */
  institution_id: string;

  /** Institution name from Plaid Link metadata */
  institution_name: string;

  /** Link session ID for idempotency */
  link_session_id: string;

  /** Account metadata from Plaid Link (optional, for validation) */
  accounts_metadata?: PlaidLinkAccountMetadata[];
}

/**
 * Account metadata from Plaid Link onSuccess callback.
 */
export interface PlaidLinkAccountMetadata {
  /** Plaid account ID */
  id: string;
  /** Account name */
  name: string;
  /** Account type (depository, credit, etc.) */
  type: string;
  /** Account subtype (checking, savings, etc.) */
  subtype: string | null;
  /** Last 4 digits of account number */
  mask: string | null;
}

// ============================================================================
// Output Types
// ============================================================================

/**
 * Response from link_plaid_account entry point.
 * Returned to the client.
 */
export interface LinkPlaidAccountResponse {
  /** The Plaid item ID */
  item_id: string;

  /** Institution ID */
  institution_id: string;

  /** Institution name */
  institution_name: string;

  /** Number of accounts linked */
  accounts_linked: number;

  /** Account IDs that were created */
  account_ids: string[];

  /** Plaid request ID for debugging */
  request_id: string;
}

/**
 * Result of the token exchange step.
 * Internal use - not returned to client.
 */
export interface TokenExchangeResult {
  /** The access token (plaintext, will be encrypted before storage) */
  access_token: string;

  /** The Plaid item ID */
  item_id: string;

  /** Plaid request ID for debugging */
  request_id: string;
}

// ============================================================================
// Resolver Types
// ============================================================================

/**
 * Input for resolving link account dependencies.
 */
export interface ResolveLinkAccountInput {
  /** User ID performing the link */
  user_id: string;

  /** Institution ID from Plaid Link metadata */
  institution_id: string;
}

/**
 * Dependencies resolved for linking accounts.
 * Gathered by resolver, used by orchestrator.
 */
export interface LinkAccountDependencies {
  /** User's group IDs for RBAC */
  group_ids: string[];

  /** Whether this institution is already linked (for duplicate detection) */
  institution_already_linked: boolean;

  /** Existing item ID if institution already linked */
  existing_item_id: string | null;
}

// ============================================================================
// Domain Service Types
// ============================================================================

/**
 * Input for validating a link account request.
 * Used by the domain service (pure function).
 */
export interface LinkAccountValidationInput {
  /** User ID performing the link */
  user_id: string;

  /** Public token to exchange */
  public_token: string;

  /** Institution ID */
  institution_id: string;

  /** Institution name */
  institution_name: string;

  /** Whether this institution is already linked */
  institution_already_linked: boolean;
}

// ============================================================================
// Plaid Item Types
// ============================================================================

/**
 * Plaid item status values from Plaid API.
 */
export type PlaidItemStatus = "good" | "item_login_required" | "pending_expiration";

/**
 * Domain entity for Plaid items.
 */
export interface PlaidItem {
  id: string;
  plaid_item_id: string;
  user_id: string;
  group_ids: string[];
  institution_id: string;
  institution_name: string;
  institution_logo: string | null;
  access_token: string; // Encrypted
  cursor: string | null;
  products: string[];
  status: PlaidItemStatus;
  error: string | null;
  last_webhook_received: Timestamp | null;
  last_sync_error: string | null;
  last_sync_error_at: Timestamp | null;
  last_synced_at: Timestamp | null;
  is_active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/**
 * Input for creating a Plaid item.
 */
export interface CreatePlaidItemInput {
  plaid_item_id: string;
  user_id: string;
  group_ids: string[];
  institution_id: string;
  institution_name: string;
  institution_logo?: string | null;
  access_token: string; // Plaintext - will be encrypted
  products?: string[];
}

// ============================================================================
// Orchestrator Types
// ============================================================================

/**
 * Result type for the link_plaid_account orchestrator.
 */
export interface LinkPlaidAccountOrchestratorResult {
  /** Whether the operation succeeded */
  success: boolean;

  /** The response data (on success) */
  data?: LinkPlaidAccountResponse;

  /** Validation errors (on failure) */
  errors?: string[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Performance budget for link_plaid_account orchestrator.
 */
export const LINK_PLAID_ACCOUNT_BUDGET = {
  max_reads: 10,
  max_writes: 15, // Item + multiple accounts
  max_time_ms: 30000, // Plaid API calls can be slow
};
