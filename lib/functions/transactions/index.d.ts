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
export { createTransaction } from "./api/crud/createTransaction";
export { getTransaction } from "./api/crud/getTransaction";
export { updateTransaction } from "./api/crud/updateTransaction";
export { updateTransactionSplits } from "./api/crud/updateTransactionSplits";
export { deleteTransaction } from "./api/crud/deleteTransaction";
export { approveTransaction } from "./api/crud/approveTransaction";
export { format_transactions, formatTransactions } from "./utils/format_transactions";
export { match_categories_to_transactions, matchCategoriesToTransactions } from "./utils/match_categories_to_transactions";
export { match_transaction_splits_to_source_periods, matchTransactionSplitsToSourcePeriods } from "./utils/match_transaction_splits_to_source_periods";
export { match_transaction_splits_to_budgets, matchTransactionSplitsToBudgets } from "./utils/match_transaction_splits_to_budgets";
export { match_transaction_splits_to_outflows, matchTransactionSplitsToOutflows } from "./utils/match_transaction_splits_to_outflows";
export { match_transaction_to_budget, matchTransactionToBudget } from "./utils/match_transaction_to_budget";
export { assign_transaction_splits, assign_transaction_splits_batch, assignTransactionSplits, assignTransactionSplitsBatch } from "./utils/assign_transaction_splits";
export { validate_and_redistribute_splits, validateAndRedistributeSplits } from "./utils/validate_and_redistribute_splits";
export { validate_and_fix_budget_ids, is_valid_budget_id, validateAndFixBudgetIds, isValidBudgetId } from "./utils/validate_budget_ids";
export { build_transaction_data, buildTransactionData } from "./utils/build_transaction_data";
export { batch_create_transactions, batchCreateTransactions } from "./utils/batch_create_transactions";
export { createTestTransactions } from "./dev/createTestTransactions";
export { createTestTransactionsByCategory } from "./dev/createTestTransactionsByCategory";
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
//# sourceMappingURL=index.d.ts.map