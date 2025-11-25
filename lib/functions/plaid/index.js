"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.reprocessPlaidTransactions = exports.getUserPlaidItems = exports.fireItemWebhook = exports.fireIncomeWebhook = exports.fireTransactionWebhook = exports.plaidErrorHandler = exports.processWebhookTransactionSync = exports.plaidWebhook = exports.onPlaidItemCreated = exports.syncRecurringTransactionsCallable = exports.syncTransactionsCallable = exports.syncBalancesCallable = exports.removePlaidAccount = exports.exchangePlaidToken = exports.createLinkToken = void 0;
// ===== API Functions =====
// CRUD Operations
var createLinkToken_1 = require("./api/crud/createLinkToken");
Object.defineProperty(exports, "createLinkToken", { enumerable: true, get: function () { return createLinkToken_1.createLinkToken; } });
var exchangePlaidToken_1 = require("./api/crud/exchangePlaidToken");
Object.defineProperty(exports, "exchangePlaidToken", { enumerable: true, get: function () { return exchangePlaidToken_1.exchangePlaidToken; } });
var removePlaidAccount_1 = require("./api/crud/removePlaidAccount");
Object.defineProperty(exports, "removePlaidAccount", { enumerable: true, get: function () { return removePlaidAccount_1.removePlaidAccount; } });
// Sync Operations
var syncBalances_1 = require("./api/sync/syncBalances");
Object.defineProperty(exports, "syncBalancesCallable", { enumerable: true, get: function () { return syncBalances_1.syncBalancesCallable; } });
var syncTransactions_1 = require("./api/sync/syncTransactions");
Object.defineProperty(exports, "syncTransactionsCallable", { enumerable: true, get: function () { return syncTransactions_1.syncTransactionsForItem; } });
var syncRecurring_1 = require("./api/sync/syncRecurring");
Object.defineProperty(exports, "syncRecurringTransactionsCallable", { enumerable: true, get: function () { return syncRecurring_1.syncRecurringTransactionsCallable; } });
// Query Operations
// fetchRecurringTransactions is exported but currently not used in main index
// export { fetchRecurringTransactions } from "./api/queries/fetchRecurringTransactions";
// ===== Orchestration Functions =====
// Triggers
var onPlaidItemCreated_1 = require("./orchestration/triggers/onPlaidItemCreated");
Object.defineProperty(exports, "onPlaidItemCreated", { enumerable: true, get: function () { return onPlaidItemCreated_1.onPlaidItemCreated; } });
// Webhooks
var plaidWebhook_1 = require("./orchestration/webhooks/plaidWebhook");
Object.defineProperty(exports, "plaidWebhook", { enumerable: true, get: function () { return plaidWebhook_1.plaidWebhook; } });
var webhookTransactionSync_1 = require("./orchestration/webhookTransactionSync");
Object.defineProperty(exports, "processWebhookTransactionSync", { enumerable: true, get: function () { return webhookTransactionSync_1.processWebhookTransactionSync; } });
// ===== Utilities =====
var plaidErrorHandler_1 = require("./utils/plaidErrorHandler");
Object.defineProperty(exports, "plaidErrorHandler", { enumerable: true, get: function () { return plaidErrorHandler_1.plaidErrorHandler; } });
// ===== Admin/Testing Functions =====
var testWebhooks_1 = require("./admin/testWebhooks");
Object.defineProperty(exports, "fireTransactionWebhook", { enumerable: true, get: function () { return testWebhooks_1.fireTransactionWebhook; } });
Object.defineProperty(exports, "fireIncomeWebhook", { enumerable: true, get: function () { return testWebhooks_1.fireIncomeWebhook; } });
Object.defineProperty(exports, "fireItemWebhook", { enumerable: true, get: function () { return testWebhooks_1.fireItemWebhook; } });
Object.defineProperty(exports, "getUserPlaidItems", { enumerable: true, get: function () { return testWebhooks_1.getUserPlaidItems; } });
var migrateTransactionSplits_1 = require("./admin/migrateTransactionSplits");
Object.defineProperty(exports, "reprocessPlaidTransactions", { enumerable: true, get: function () { return migrateTransactionSplits_1.reprocessPlaidTransactions; } });
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
//# sourceMappingURL=index.js.map