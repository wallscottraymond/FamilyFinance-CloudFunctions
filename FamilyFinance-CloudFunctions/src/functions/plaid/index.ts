/**
 * Plaid Integration Cloud Functions
 *
 * This module provides comprehensive Plaid integration for the Family Finance app,
 * including account linking, transaction sync, webhook handling, and account management.
 *
 * Functions included:
 * - createLinkToken: Generate secure link tokens for Plaid Link initialization
 * - exchangePlaidToken: Exchange public token for access token and link bank accounts
 * - fetchRecurringTransactions: Fetch recurring transaction streams from Plaid
 * - plaidWebhook: Handle real-time webhook updates from Plaid
 * - syncBalances: Manual sync of account balances
 * - syncTransactions: Manual sync of transactions
 * - syncRecurringTransactions: Manual sync of recurring transactions
 * - removePlaidAccount: Safely remove bank account connections
 *
 * Security Features:
 * - Access token encryption using AES-256-GCM
 * - Webhook signature verification
 * - User authentication and authorization
 * - Secure CORS handling
 *
 * Data Flow:
 * 1. User links account via exchangePlaidToken
 * 2. onPlaidItemCreated trigger automatically syncs balances, transactions, and recurring
 * 3. Real-time updates received via plaidWebhook
 * 4. Manual sync available via callable functions
 * 5. Clean removal via removePlaidAccount
 *
 * All functions use Firebase v2 with proper error handling and the requested
 * Promise wrapping pattern for consistent async operation handling.
 */

// ===== API Functions =====

// CRUD Operations
export { createLinkToken } from "./api/crud/createLinkToken";
export { exchangePlaidToken } from "./api/crud/exchangePlaidToken";
export { removePlaidAccount } from "./api/crud/removePlaidAccount";

// Sync Operations
export { syncBalancesCallable } from "./api/sync/syncBalances";
export { syncTransactionsForItem as syncTransactionsCallable } from "./api/sync/syncTransactions";
export { syncRecurringTransactionsCallable } from "./api/sync/syncRecurring";

// Query Operations
// fetchRecurringTransactions is exported but currently not used in main index
// export { fetchRecurringTransactions } from "./api/queries/fetchRecurringTransactions";

// ===== Orchestration Functions =====

// Triggers
export { onPlaidItemCreated } from "./orchestration/triggers/onPlaidItemCreated";

// Webhooks
export { plaidWebhook } from "./orchestration/webhooks/plaidWebhook";
export { processWebhookTransactionSync } from "./orchestration/webhookTransactionSync";

// ===== Utilities =====

export { plaidErrorHandler } from "./utils/plaidErrorHandler";

// ===== Admin/Testing Functions =====

export {
  fireTransactionWebhook,
  fireIncomeWebhook,
  fireItemWebhook,
  getUserPlaidItems
} from "./admin/testWebhooks";

export { reprocessPlaidTransactions } from "./admin/migrateTransactionSplits";

/**
 * Function Overview:
 *
 * createLinkToken:
 * - Purpose: Generate secure link tokens for Plaid Link initialization
 * - Authentication: Requires VIEWER role
 * - Memory: 256MiB, Timeout: 30s
 * - Location: api/crud/createLinkToken.ts
 *
 * exchangePlaidToken:
 * - Purpose: Convert Plaid Link public token to access token and store account data
 * - Authentication: Requires VIEWER role
 * - Memory: 256MiB, Timeout: 30s
 * - Location: api/crud/exchangePlaidToken.ts
 *
 * removePlaidAccount:
 * - Purpose: Safely disconnect bank account and clean up data
 * - Authentication: Requires VIEWER role
 * - Memory: 256MiB, Timeout: 30s
 * - Location: api/crud/removePlaidAccount.ts
 *
 * syncBalancesCallable:
 * - Purpose: Manually refresh account balances from Plaid
 * - Authentication: Requires VIEWER role
 * - Memory: 256MiB, Timeout: 60s
 * - Location: api/sync/syncBalances.ts
 *
 * syncTransactionsCallable:
 * - Purpose: Manually sync transactions for a specific Plaid item using /transactions/sync
 * - Authentication: Requires VIEWER role
 * - Memory: 512MiB, Timeout: 300s
 * - Location: api/sync/syncTransactions.ts
 *
 * syncRecurringTransactionsCallable:
 * - Purpose: Manually sync recurring transaction streams (inflows/outflows)
 * - Authentication: Requires VIEWER role
 * - Memory: 512MiB, Timeout: 120s
 * - Location: api/sync/syncRecurring.ts
 *
 * onPlaidItemCreated:
 * - Purpose: Firestore trigger that auto-syncs all data when new Plaid item is linked
 * - Triggers: When document created in plaid_items collection
 * - Memory: 1GiB, Timeout: 540s
 * - Location: orchestration/triggers/onPlaidItemCreated.ts
 *
 * plaidWebhook:
 * - Purpose: Handle real-time webhook notifications from Plaid
 * - Authentication: Webhook signature verification only
 * - Memory: 512MiB, Timeout: 30s
 * - CORS: Disabled (webhook endpoint)
 * - Location: orchestration/webhooks/plaidWebhook.ts
 *
 * plaidErrorHandler:
 * - Purpose: Centralized Plaid API error handling and item status updates
 * - Location: utils/plaidErrorHandler.ts
 *
 * fireTransactionWebhook, fireIncomeWebhook, fireItemWebhook:
 * - Purpose: Sandbox testing utilities for webhook development
 * - Authentication: Requires VIEWER role
 * - Memory: 256MiB, Timeout: 30s
 * - Location: admin/testWebhooks.ts
 */
