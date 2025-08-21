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
 * - refreshPlaidData: Manual refresh of account and transaction data
 * - unlinkPlaidAccount: Safely remove bank account connections
 * - getUnlinkPreview: Preview what will be affected before unlinking
 * 
 * Security Features:
 * - Access token encryption using AES-256-GCM
 * - Webhook signature verification
 * - User authentication and authorization
 * - Secure CORS handling
 * 
 * Data Flow:
 * 1. User links account via exchangePlaidToken
 * 2. Real-time updates received via plaidWebhook
 * 3. Manual sync available via refreshPlaidData
 * 4. Clean removal via unlinkPlaidAccount
 * 
 * All functions use Firebase v2 with proper error handling and the requested
 * Promise wrapping pattern for consistent async operation handling.
 */

// Export all Plaid-related cloud functions
export { createLinkToken } from "./createLinkToken";
export { exchangePlaidToken } from "./exchangePlaidToken"; // Using real Plaid API
export { fetchRecurringTransactions } from "./fetchRecurringTransactions";
export { plaidWebhook } from "./plaidWebhook";
// export { refreshPlaidData } from "./refreshPlaidData";
// export { unlinkPlaidAccount, getUnlinkPreview } from "./unlinkPlaidAccount";

/**
 * Function Overview:
 * 
 * createLinkToken:
 * - Purpose: Generate secure link tokens for Plaid Link initialization
 * - Authentication: Requires VIEWER role
 * - Memory: 256MiB, Timeout: 30s
 * - Promise Pattern: ✓
 * 
 * exchangePlaidToken:
 * - Purpose: Convert Plaid Link public token to access token and store account data
 * - Authentication: Requires VIEWER role
 * - Memory: 256MiB, Timeout: 30s
 * - Promise Pattern: ✓
 * 
 * fetchRecurringTransactions:
 * - Purpose: Fetch recurring transaction streams from Plaid for analysis
 * - Authentication: Requires VIEWER role
 * - Memory: 512MiB, Timeout: 60s
 * - Promise Pattern: ✓
 * 
 * plaidWebhook:
 * - Purpose: Handle real-time webhook notifications from Plaid including recurring transactions
 * - Authentication: Webhook signature verification only
 * - Memory: 512MiB, Timeout: 60s
 * - CORS: Disabled (webhook endpoint)
 * - Promise Pattern: ✓
 * 
 * refreshPlaidData:
 * - Purpose: Manual refresh of account balances and transactions
 * - Authentication: Requires EDITOR role
 * - Memory: 1GiB, Timeout: 120s
 * - Promise Pattern: ✓
 * 
 * unlinkPlaidAccount:
 * - Purpose: Safely disconnect bank account and clean up data
 * - Authentication: Requires EDITOR role
 * - Memory: 512MiB, Timeout: 120s
 * - Promise Pattern: ✓
 * 
 * getUnlinkPreview:
 * - Purpose: Preview impact of unlinking before actual removal
 * - Authentication: Requires VIEWER role
 * - Memory: 256MiB, Timeout: 30s
 * - Promise Pattern: ✓
 */