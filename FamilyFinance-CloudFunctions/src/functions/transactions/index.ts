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
 * - getUserTransactions: Query user-specific transactions
 * - getFamilyTransactions: Query all family transactions
 * - approveTransaction: Approve or reject pending transactions
 * - onInflowCreated: Automatic inflow period generation trigger
 *
 * Architecture:
 * - api/crud: CRUD operations (Create, Read, Update, Delete, Approve)
 * - api/queries: Query operations (User and Family transaction lists)
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
export { getUserTransactions } from "./api/queries/getUserTransactions";
export { getFamilyTransactions } from "./api/queries/getFamilyTransactions";

// ===== Orchestration Functions =====

// Triggers
export { onInflowCreated } from "./orchestration/triggers/onInflowCreated";

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
 * getUserTransactions:
 * - Purpose: Query transactions for a specific user
 * - Authentication: Requires VIEWER role
 * - Memory: 256MiB, Timeout: 30s
 * - Location: api/queries/getUserTransactions.ts
 *
 * getFamilyTransactions:
 * - Purpose: Query all transactions for a family
 * - Authentication: Requires EDITOR role
 * - Memory: 256MiB, Timeout: 30s
 * - Location: api/queries/getFamilyTransactions.ts
 *
 * onInflowCreated:
 * - Purpose: Automatically generate inflow_periods when inflow is created
 * - Triggers: When document created in inflows collection
 * - Memory: 512MiB, Timeout: 60s
 * - Location: orchestration/triggers/onInflowCreated.ts
 */
