/**
 * Balance Sync Types
 *
 * Types for the sync_balances flow in the 5-layer architecture.
 *
 * @module types/plaid/balance_sync
 */

// ============================================================================
// Input Types
// ============================================================================

/**
 * Input for syncing account balances.
 * Validated by Zod in the entry layer.
 */
export interface SyncBalancesInput {
  /** Optional: Sync only accounts for a specific Plaid item */
  item_id?: string;

  /** Optional: Sync only specific account IDs */
  account_ids?: string[];
}

// ============================================================================
// Output Types
// ============================================================================

/**
 * Result of syncing a single account's balance.
 */
export interface BalanceSyncAccountResult {
  /** The account ID that was updated */
  account_id: string;

  /** Whether the update succeeded */
  success: boolean;

  /** Previous balance (for change detection) */
  previous_balance?: number;

  /** New balance from Plaid */
  new_balance?: number;

  /** Error message if update failed */
  error?: string;
}

/**
 * Result of syncing balances for a Plaid item.
 */
export interface BalanceSyncItemResult {
  /** The Plaid item ID */
  item_id: string;

  /** Whether the sync succeeded for this item */
  success: boolean;

  /** Results for each account in this item */
  accounts: BalanceSyncAccountResult[];

  /** Error message if the entire item sync failed */
  error?: string;
}

/**
 * Account data formatted for client response (camelCase).
 * Entry layer maps this to the client without modification.
 */
export interface ClientAccountData {
  id: string;
  plaidAccountId: string;
  accountId: string;
  itemId: string;
  userId: string;
  familyId: string;
  institutionId: string;
  institutionName: string;
  accountName: string;
  accountType: string;
  accountSubtype: string;
  mask?: string;
  officialName?: string;
  currentBalance: number;
  availableBalance?: number;
  creditLimit?: number;
  isoCurrencyCode: string;
  isActive: boolean;
  isSyncEnabled: boolean;
  lastBalanceUpdate?: Date;
  lastUpdated?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Aggregated results from domain service (without accounts).
 * Used by domain service which cannot perform IO.
 */
export interface BalanceSyncAggregatedResult {
  /** Whether the overall sync succeeded */
  success: boolean;

  /** Number of accounts updated */
  accounts_updated: number;

  /** Number of accounts that failed to update */
  accounts_failed: number;

  /** Results per Plaid item */
  items: BalanceSyncItemResult[];

  /** Accounts that had balance changes */
  balance_changes: Array<{
    account_id: string;
    previous: number;
    current: number;
  }>;
}

/**
 * Response from sync_balances orchestrator.
 * Extends aggregated result with fetched accounts.
 */
export interface SyncBalancesResponse extends BalanceSyncAggregatedResult {
  /** Updated accounts in client format (camelCase) */
  accounts: ClientAccountData[];
}

// ============================================================================
// Resolver Types
// ============================================================================

/**
 * Dependencies resolved for balance sync.
 */
export interface BalanceSyncDependencies {
  /** Plaid items to sync (with decrypted access tokens and institution info) */
  items: Array<{
    item_id: string;
    access_token: string;
    institution_id: string;
    institution_name: string;
    group_id?: string;
  }>;

  /** Local accounts grouped by item_id for tracking changes (optional for upsert) */
  accounts_by_item: Map<string, Array<{
    id: string;
    plaid_account_id: string;
    current_balance: number;
  }>>;

  /** Total number of accounts to sync */
  total_accounts: number;
}

/**
 * Input for resolving balance sync dependencies.
 */
export interface ResolveBalanceSyncInput {
  /** User ID */
  user_id: string;

  /** Optional: Sync only a specific item */
  item_id?: string;

  /** Optional: Sync only specific account IDs */
  account_ids?: string[];
}

// ============================================================================
// Domain Types
// ============================================================================

/**
 * Balance update to apply to an account.
 * Output from transformer, input to repository.
 */
export interface BalanceUpdate {
  /** Local account document ID */
  account_doc_id: string;

  /** Plaid account ID (for matching) */
  plaid_account_id: string;

  /** Current balance from Plaid */
  current_balance: number;

  /** Available balance from Plaid */
  available_balance?: number;

  /** Credit limit from Plaid */
  limit?: number;

  /** ISO currency code */
  iso_currency_code?: string;
}

/**
 * Input for validating balance updates.
 */
export interface BalanceValidationInput {
  /** Updates to validate */
  updates: BalanceUpdate[];

  /** User ID performing the sync */
  user_id: string;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Payload for account.balance_updated event.
 */
export interface BalanceUpdatedEventPayload {
  /** Account document ID */
  account_id: string;

  /** User ID */
  user_id: string;

  /** Previous balance */
  previous_balance: number;

  /** New balance */
  new_balance: number;

  /** Change amount (new - previous) */
  change_amount: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Performance budget for balance sync.
 */
export const SYNC_BALANCES_BUDGET = {
  /** Maximum Firestore read operations */
  max_reads: 50,

  /** Maximum Firestore write operations */
  max_writes: 100,

  /** Maximum execution time (60 seconds) */
  max_time_ms: 60000,
};

/**
 * Rate limit for manual balance refreshes (in seconds).
 */
export const BALANCE_SYNC_RATE_LIMIT_SECONDS = 300; // 5 minutes
