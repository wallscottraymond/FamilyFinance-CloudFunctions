"use strict";
/**
 * Transactions Module - Cloud Functions
 *
 * This module provides comprehensive transaction management for the Family Finance app,
 * including CRUD operations, querying, approval workflows, and automatic inflow period generation.
 *
 * Functions included:
 * - createTransaction: Create new transactions with budget integration
 * - getTransaction: Retrieve single transaction by ID
 * - updateTransaction: Update existing transactions
 * - deleteTransaction: Remove transactions with budget cleanup
 * - approveTransaction: Approve or reject pending transactions
 * - onTransactionCreate: Automatic budget spending update on creation
 * - onTransactionUpdate: Automatic budget spending recalculation on update
 * - onTransactionDelete: Automatic budget spending reversal on deletion
 *
 * Note: Query operations (getUserTransactions, getFamilyTransactions) have been removed.
 * Mobile app uses direct Firestore access for better performance and real-time updates.
 * Note: onInflowCreated has been moved to the inflows module.
 *
 * Architecture:
 * - api/crud: CRUD operations (Create, Read, Update, Delete, Approve)
 * - api/queries: [Deprecated - Mobile app uses direct Firestore access]
 * - orchestration/triggers: Firestore triggers (Inflow period generation)
 * - utils: Shared utilities (placeholder for future transaction helpers)
 * - config: Configuration constants (placeholder)
 * - types: TypeScript type definitions (placeholder)
 * - admin: Admin and testing functions (placeholder)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTestTransactionsByCategory = exports.createTestTransactions = exports.batchCreateTransactions = exports.batch_create_transactions = exports.buildTransactionData = exports.build_transaction_data = exports.isValidBudgetId = exports.validateAndFixBudgetIds = exports.is_valid_budget_id = exports.validate_and_fix_budget_ids = exports.validateAndRedistributeSplits = exports.validate_and_redistribute_splits = exports.assignTransactionSplitsBatch = exports.assignTransactionSplits = exports.assign_transaction_splits_batch = exports.assign_transaction_splits = exports.matchTransactionToBudget = exports.match_transaction_to_budget = exports.matchTransactionSplitsToOutflows = exports.match_transaction_splits_to_outflows = exports.matchTransactionSplitsToBudgets = exports.match_transaction_splits_to_budgets = exports.matchTransactionSplitsToSourcePeriods = exports.match_transaction_splits_to_source_periods = exports.matchCategoriesToTransactions = exports.match_categories_to_transactions = exports.formatTransactions = exports.format_transactions = exports.approveTransaction = exports.deleteTransaction = exports.updateTransactionSplits = exports.updateTransaction = exports.getTransaction = exports.createTransaction = void 0;
// ===== API Functions =====
// CRUD Operations
var createTransaction_1 = require("./api/crud/createTransaction");
Object.defineProperty(exports, "createTransaction", { enumerable: true, get: function () { return createTransaction_1.createTransaction; } });
var getTransaction_1 = require("./api/crud/getTransaction");
Object.defineProperty(exports, "getTransaction", { enumerable: true, get: function () { return getTransaction_1.getTransaction; } });
var updateTransaction_1 = require("./api/crud/updateTransaction");
Object.defineProperty(exports, "updateTransaction", { enumerable: true, get: function () { return updateTransaction_1.updateTransaction; } });
var updateTransactionSplits_1 = require("./api/crud/updateTransactionSplits"); // Callable version for mobile
Object.defineProperty(exports, "updateTransactionSplits", { enumerable: true, get: function () { return updateTransactionSplits_1.updateTransactionSplits; } });
var deleteTransaction_1 = require("./api/crud/deleteTransaction");
Object.defineProperty(exports, "deleteTransaction", { enumerable: true, get: function () { return deleteTransaction_1.deleteTransaction; } });
var approveTransaction_1 = require("./api/crud/approveTransaction");
Object.defineProperty(exports, "approveTransaction", { enumerable: true, get: function () { return approveTransaction_1.approveTransaction; } });
// Query Operations
// Note: getUserTransactions and getFamilyTransactions have been removed
// Mobile app uses direct Firestore access for transaction queries
// ===== UTIL Functions (snake_case - new architecture) =====
var format_transactions_1 = require("./utils/format_transactions");
Object.defineProperty(exports, "format_transactions", { enumerable: true, get: function () { return format_transactions_1.format_transactions; } });
Object.defineProperty(exports, "formatTransactions", { enumerable: true, get: function () { return format_transactions_1.formatTransactions; } });
var match_categories_to_transactions_1 = require("./utils/match_categories_to_transactions");
Object.defineProperty(exports, "match_categories_to_transactions", { enumerable: true, get: function () { return match_categories_to_transactions_1.match_categories_to_transactions; } });
Object.defineProperty(exports, "matchCategoriesToTransactions", { enumerable: true, get: function () { return match_categories_to_transactions_1.matchCategoriesToTransactions; } });
var match_transaction_splits_to_source_periods_1 = require("./utils/match_transaction_splits_to_source_periods");
Object.defineProperty(exports, "match_transaction_splits_to_source_periods", { enumerable: true, get: function () { return match_transaction_splits_to_source_periods_1.match_transaction_splits_to_source_periods; } });
Object.defineProperty(exports, "matchTransactionSplitsToSourcePeriods", { enumerable: true, get: function () { return match_transaction_splits_to_source_periods_1.matchTransactionSplitsToSourcePeriods; } });
var match_transaction_splits_to_budgets_1 = require("./utils/match_transaction_splits_to_budgets");
Object.defineProperty(exports, "match_transaction_splits_to_budgets", { enumerable: true, get: function () { return match_transaction_splits_to_budgets_1.match_transaction_splits_to_budgets; } });
Object.defineProperty(exports, "matchTransactionSplitsToBudgets", { enumerable: true, get: function () { return match_transaction_splits_to_budgets_1.matchTransactionSplitsToBudgets; } });
var match_transaction_splits_to_outflows_1 = require("./utils/match_transaction_splits_to_outflows");
Object.defineProperty(exports, "match_transaction_splits_to_outflows", { enumerable: true, get: function () { return match_transaction_splits_to_outflows_1.match_transaction_splits_to_outflows; } });
Object.defineProperty(exports, "matchTransactionSplitsToOutflows", { enumerable: true, get: function () { return match_transaction_splits_to_outflows_1.matchTransactionSplitsToOutflows; } });
var match_transaction_to_budget_1 = require("./utils/match_transaction_to_budget");
Object.defineProperty(exports, "match_transaction_to_budget", { enumerable: true, get: function () { return match_transaction_to_budget_1.match_transaction_to_budget; } });
Object.defineProperty(exports, "matchTransactionToBudget", { enumerable: true, get: function () { return match_transaction_to_budget_1.matchTransactionToBudget; } });
var assign_transaction_splits_1 = require("./utils/assign_transaction_splits");
Object.defineProperty(exports, "assign_transaction_splits", { enumerable: true, get: function () { return assign_transaction_splits_1.assign_transaction_splits; } });
Object.defineProperty(exports, "assign_transaction_splits_batch", { enumerable: true, get: function () { return assign_transaction_splits_1.assign_transaction_splits_batch; } });
Object.defineProperty(exports, "assignTransactionSplits", { enumerable: true, get: function () { return assign_transaction_splits_1.assignTransactionSplits; } });
Object.defineProperty(exports, "assignTransactionSplitsBatch", { enumerable: true, get: function () { return assign_transaction_splits_1.assignTransactionSplitsBatch; } });
var validate_and_redistribute_splits_1 = require("./utils/validate_and_redistribute_splits");
Object.defineProperty(exports, "validate_and_redistribute_splits", { enumerable: true, get: function () { return validate_and_redistribute_splits_1.validate_and_redistribute_splits; } });
Object.defineProperty(exports, "validateAndRedistributeSplits", { enumerable: true, get: function () { return validate_and_redistribute_splits_1.validateAndRedistributeSplits; } });
var validate_budget_ids_1 = require("./utils/validate_budget_ids");
Object.defineProperty(exports, "validate_and_fix_budget_ids", { enumerable: true, get: function () { return validate_budget_ids_1.validate_and_fix_budget_ids; } });
Object.defineProperty(exports, "is_valid_budget_id", { enumerable: true, get: function () { return validate_budget_ids_1.is_valid_budget_id; } });
Object.defineProperty(exports, "validateAndFixBudgetIds", { enumerable: true, get: function () { return validate_budget_ids_1.validateAndFixBudgetIds; } });
Object.defineProperty(exports, "isValidBudgetId", { enumerable: true, get: function () { return validate_budget_ids_1.isValidBudgetId; } });
var build_transaction_data_1 = require("./utils/build_transaction_data");
Object.defineProperty(exports, "build_transaction_data", { enumerable: true, get: function () { return build_transaction_data_1.build_transaction_data; } });
Object.defineProperty(exports, "buildTransactionData", { enumerable: true, get: function () { return build_transaction_data_1.buildTransactionData; } });
var batch_create_transactions_1 = require("./utils/batch_create_transactions");
Object.defineProperty(exports, "batch_create_transactions", { enumerable: true, get: function () { return batch_create_transactions_1.batch_create_transactions; } });
Object.defineProperty(exports, "batchCreateTransactions", { enumerable: true, get: function () { return batch_create_transactions_1.batchCreateTransactions; } });
// ===== Orchestration Functions =====
// Triggers — REMOVED in the Transaction Assignment Engine cutover.
// The legacy increment-model triggers (onTransactionCreate/Update/Delete →
// updateBudgetSpending) are replaced by `on_transaction_written`
// (entry/triggers/), which enqueues `assign_transaction` and fans out
// invalidation-based `recompute_budget_spent` jobs.
// ===== Development/Testing Functions =====
// These functions are for local development only - they seed test data
var createTestTransactions_1 = require("./dev/createTestTransactions");
Object.defineProperty(exports, "createTestTransactions", { enumerable: true, get: function () { return createTestTransactions_1.createTestTransactions; } });
var createTestTransactionsByCategory_1 = require("./dev/createTestTransactionsByCategory");
Object.defineProperty(exports, "createTestTransactionsByCategory", { enumerable: true, get: function () { return createTestTransactionsByCategory_1.createTestTransactionsByCategory; } });
// ===== Admin Functions =====
// (Legacy admin functions can be placed here)
/**
 * Function Overview:
 *
 * createTransaction:
 * - Purpose: Create new transaction with automatic budget integration and splitting
 * - Authentication: Requires VIEWER role
 * - Memory: 256MiB, Timeout: 30s
 * - Location: api/crud/createTransaction.ts
 *
 * getTransaction:
 * - Purpose: Retrieve a single transaction by ID
 * - Authentication: Requires VIEWER role
 * - Memory: 256MiB, Timeout: 30s
 * - Location: api/crud/getTransaction.ts
 *
 * updateTransaction:
 * - Purpose: Update existing transaction with budget recalculation
 * - Authentication: Requires VIEWER role (own transactions) or ADMIN
 * - Memory: 256MiB, Timeout: 30s
 * - Location: api/crud/updateTransaction.ts
 *
 * deleteTransaction:
 * - Purpose: Delete transaction and reverse budget spending
 * - Authentication: Requires VIEWER role (own transactions) or ADMIN
 * - Memory: 256MiB, Timeout: 30s
 * - Location: api/crud/deleteTransaction.ts
 *
 * approveTransaction:
 * - Purpose: Approve or reject pending transactions
 * - Authentication: Requires EDITOR role
 * - Memory: 256MiB, Timeout: 30s
 * - Location: api/crud/approveTransaction.ts
 *
 * Note: getUserTransactions and getFamilyTransactions have been removed.
 * Mobile app uses direct Firestore access for better performance and real-time updates.
 *
 * onTransactionCreate:
 * - Purpose: Update budget spending when new transaction is created
 * - Triggers: When document created in transactions collection
 * - Memory: 256MiB, Timeout: 60s
 * - Location: orchestration/triggers/onTransactionCreate.ts
 *
 * onTransactionUpdate:
 * - Purpose: Recalculate budget spending when transaction is modified
 * - Triggers: When document updated in transactions collection
 * - Memory: 256MiB, Timeout: 60s
 * - Location: orchestration/triggers/onTransactionUpdate.ts
 *
 * onTransactionDelete:
 * - Purpose: Reverse budget spending when transaction is deleted
 * - Triggers: When document deleted from transactions collection
 * - Memory: 256MiB, Timeout: 60s
 * - Location: orchestration/triggers/onTransactionDelete.ts
 */
//# sourceMappingURL=index.js.map