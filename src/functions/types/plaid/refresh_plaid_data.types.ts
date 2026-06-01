/**
 * Refresh Plaid Data Types
 *
 * Types for the combined balance + transaction sync flow
 * triggered by pull-to-refresh in the mobile app.
 *
 * @module types/plaid/refresh_plaid_data
 */

import { ClientAccountData } from "./balance_sync.types";

/**
 * Input for the refresh_plaid_data callable.
 */
export interface RefreshPlaidDataInput {
  /** Optional: Sync only a specific Plaid item */
  item_id?: string;

  /** Optional: Sync only specific account IDs */
  account_ids?: string[];
}

/**
 * Resolver input for refresh dependencies.
 */
export interface ResolveRefreshInput {
  user_id: string;
  item_id?: string;
  account_ids?: string[];
}

/**
 * Dependencies resolved for refresh operation.
 */
export interface RefreshPlaidDataDependencies {
  /** Plaid items to sync */
  items: Array<{
    item_id: string;
    doc_id: string;
    access_token: string;
    institution_name: string;
  }>;

  /** User context for transaction sync */
  user_context: {
    group_ids: string[];
    family_id: string | null;
    currency: string;
  };

  /** Whether rate limited */
  rate_limited_items: string[];
}

/**
 * Result of the balance sync phase.
 */
export interface BalanceSyncPhaseResult {
  success: boolean;
  accounts: ClientAccountData[];
  accounts_updated: number;
  accounts_failed: number;
  balance_changes: number;
  errors: string[];
}

/**
 * Result of the transaction sync phase.
 */
export interface TransactionSyncPhaseResult {
  success: boolean;
  item_id: string;
  added_count: number;
  modified_count: number;
  removed_count: number;
  pending_migrated_count: number;
  error?: string;
}

/**
 * Response from the refresh_plaid_data orchestrator.
 */
export interface RefreshPlaidDataResponse {
  success: boolean;

  // Balance sync results
  accounts: ClientAccountData[];
  accounts_updated: number;
  accounts_failed: number;
  balance_changes: number;

  // Transaction sync results
  transactions_added: number;
  transactions_modified: number;
  transactions_removed: number;
  pending_migrated: number;

  // Overall status
  items_synced: number;
  items_failed: number;
  items_rate_limited: number;

  // Errors (if any)
  errors?: string[];
}

/**
 * Performance budget for the refresh operation.
 */
export const REFRESH_PLAID_DATA_BUDGET = {
  /** Maximum Firestore read operations */
  max_reads: 75,

  /** Maximum Firestore write operations */
  max_writes: 150,

  /** Maximum execution time in milliseconds (60 seconds for callable) */
  max_time_ms: 60000,
};
