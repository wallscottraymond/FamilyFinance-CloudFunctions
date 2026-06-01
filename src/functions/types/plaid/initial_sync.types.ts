/**
 * Plaid Initial Sync Types
 *
 * Types for the plaid_initial_sync_orchestrator flow.
 * This orchestrates the complete initial data sync when a Plaid item is created.
 *
 * @module types/plaid/initial_sync
 */

import { PlaidInstitutionInfo } from "../../integrations/plaid";

// ============================================================================
// Input Types
// ============================================================================

/**
 * Input for the initial sync orchestrator.
 * Extracted from the plaid_item document that triggered the sync.
 */
export interface InitialSyncInput {
  /** The document ID of the plaid_item */
  item_doc_id: string;

  /** The Plaid item ID */
  plaid_item_id: string;

  /** The user who owns this item */
  user_id: string;

  /** Institution ID from Plaid */
  institution_id: string;

  /** Institution name from Plaid */
  institution_name: string;
}

// ============================================================================
// Resolver Types
// ============================================================================

/**
 * Dependencies resolved for the initial sync.
 */
export interface InitialSyncDependencies {
  /** The plaid_item data */
  plaid_item: {
    id: string;
    /** Decrypted access token (handled by resolver) */
    access_token: string;
    /** Cursor for transaction sync (null for initial) */
    cursor: string | null;
  };

  /** User's group IDs for RBAC */
  group_ids: string[];

  /** Institution information */
  institution: PlaidInstitutionInfo;
}

// ============================================================================
// Domain Types
// ============================================================================

/**
 * Input for validating initial sync can proceed.
 */
export interface InitialSyncValidationInput {
  /** The Plaid item ID */
  plaid_item_id: string;

  /** The user ID */
  user_id: string;

  /** Whether the item exists and is active */
  item_exists: boolean;

  /** Whether the access token is present */
  has_access_token: boolean;
}

// ============================================================================
// Output Types
// ============================================================================

/**
 * Result of a single sync phase.
 */
export interface SyncPhaseResult {
  /** Which phase this represents */
  phase: "accounts" | "transactions" | "recurring";

  /** Whether the phase succeeded */
  success: boolean;

  /** Counts of operations performed */
  counts: {
    created: number;
    updated: number;
    removed?: number;
    errors: number;
  };

  /** Error message if phase failed */
  error_message?: string;

  /** How long this phase took in milliseconds */
  duration_ms: number;
}

/**
 * Result from the initial sync orchestrator.
 */
export interface InitialSyncOrchestratorResult {
  /** Whether the overall sync succeeded */
  success: boolean;

  /** Results from each phase */
  phases: SyncPhaseResult[];

  /** Summary statistics */
  summary: {
    accounts_created: number;
    transactions_added: number;
    transactions_modified: number;
    transactions_removed: number;
    inflows_created: number;
    inflows_updated: number;
    outflows_created: number;
    outflows_updated: number;
    total_duration_ms: number;
  };

  /** Error messages if any phases failed */
  errors?: string[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Performance budget for the initial sync orchestrator.
 * This is a long-running operation so budget is generous.
 */
export const INITIAL_SYNC_BUDGET = {
  /** Maximum Firestore read operations */
  max_reads: 100,

  /** Maximum Firestore write operations (accounts + transactions + recurring) */
  max_writes: 500,

  /** Maximum execution time (9 minutes - close to Cloud Functions max) */
  max_time_ms: 540000,
};
