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

// ===== API Functions =====

// CRUD Operations
export { createTransaction } from "./api/crud/createTransaction";
export { getTransaction } from "./api/crud/getTransaction";
export { updateTransaction } from "./api/crud/updateTransaction";
export { deleteTransaction } from "./api/crud/deleteTransaction";
export { approveTransaction } from "./api/crud/approveTransaction";

// Query Operations
// Note: getUserTransactions and getFamilyTransactions have been removed
// Mobile app uses direct Firestore access for transaction queries

// ===== Orchestration Functions =====

// Triggers
export { onTransactionCreate } from "./orchestration/triggers/onTransactionCreate";
export { onTransactionUpdate } from "./orchestration/triggers/onTransactionUpdate";
export { onTransactionDelete } from "./orchestration/triggers/onTransactionDelete";

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
