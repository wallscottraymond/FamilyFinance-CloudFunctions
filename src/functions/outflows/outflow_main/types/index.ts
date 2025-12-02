/**
 * Outflow Main Types
 *
 * Types related to the main outflow (recurring bill) entity.
 *
 * ⚠️ CRITICAL: This file defines the CORRECT structure for outflows.
 *
 * CORRECT STRUCTURE (2025-01-03):
 * - ✅ groupId: string (group association, null = private)
 * - ✅ averageAmount: number (FLAT, NOT nested!)
 * - ✅ lastAmount: number (FLAT, NOT nested!)
 * - ✅ currency: string (FLAT)
 *
 * INCORRECT LEGACY STRUCTURE (DO NOT USE):
 * - ❌ groupIds: string[] (array)
 * - ❌ accessibleBy: string[] (denormalized array)
 * - ❌ access: { nested object } (old RBAC system)
 * - ❌ averageAmount: { amount, isoCurrencyCode } (nested object)
 */

import { Timestamp } from "firebase-admin/firestore";
import { BaseDocument } from "../../../../types/base";

// =======================
// OUTFLOW ENUMS
// =======================

/**
 * Outflow Status (from Plaid)
 */
export enum OutflowStatus {
  MATURE = "MATURE",                    // Has at least 3 transactions
  EARLY_DETECTION = "EARLY_DETECTION"   // First detection
}

/**
 * Outflow Frequency (standardized Plaid format)
 */
export enum OutflowFrequency {
  WEEKLY = "WEEKLY",
  BIWEEKLY = "BIWEEKLY",
  SEMI_MONTHLY = "SEMI_MONTHLY",
  MONTHLY = "MONTHLY",
  ANNUALLY = "ANNUALLY"
}

/**
 * Expense Type Classification
 */
export type ExpenseType = 'subscription' | 'utility' | 'loan' | 'rent' | 'insurance' | 'tax' | 'other';

// =======================
// OUTFLOW DOCUMENT
// =======================

/**
 * Outflow (Recurring Expense) - FLAT STRUCTURE
 *
 * ✅ THIS IS THE CORRECT STRUCTURE TO USE
 *
 * Example of CORRECT usage:
 * ```typescript
 * const outflow: Outflow = {
 *   userId: 'user123',
 *   groupId: 'group_abc',      // Group association (null = private)
 *   streamId: 'stream_abc',
 *   averageAmount: 89.99,      // ✅ Direct number
 *   lastAmount: 89.99,         // ✅ Direct number
 *   currency: 'USD',           // ✅ Direct string
 *   // ...
 * };
 * ```
 */
export interface Outflow extends BaseDocument {
  // === DOCUMENT IDENTITY ===
  id: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;

  // === OWNERSHIP & ACCESS ===
  userId: string;                      // Owner user ID (REQUIRED for queries)
  groupId: string;                     // ✅ Group association (null = private)
  isActive: boolean;                   // Active status
  status: OutflowStatus;               // Maturity status

  // === PLAID IDENTIFIERS ===
  streamId: string;                    // Plaid recurring stream ID
  itemId: string;                      // Plaid item reference
  accountId: string;                   // Plaid account reference

  // === FINANCIAL DATA (FLAT STRUCTURE) ===
  // ⚠️ CRITICAL: These are FLAT numbers, NOT nested objects!
  averageAmount: number;               // ✅ FLAT: 89.99 (NOT {amount: 89.99})
  lastAmount: number;                  // ✅ FLAT: 89.99
  currency: string;                    // ✅ FLAT: "USD"
  unofficialCurrency: string | null;   // Unofficial currency

  // === DESCRIPTIVE INFO ===
  description: string;                 // Bill description
  merchantName: string | null;         // Merchant name
  category: string[];                  // Plaid category hierarchy
  personalFinanceCategory: any | null; // Plaid enhanced category

  // === TEMPORAL DATA ===
  frequency: OutflowFrequency;         // How often bill recurs
  firstDate: Timestamp;                // First occurrence
  lastDate: Timestamp;                 // Last occurrence
  predictedNextDate?: Timestamp;       // Predicted next

  // === CLASSIFICATION ===
  expenseType: ExpenseType;            // Type of expense
  isEssential: boolean;                // Essential flag
  merchantCategory: string | null;     // Merchant category
  isCancellable: boolean;              // Can be cancelled
  reminderDays: number;                // Days before due

  // === STATUS & CONTROL ===
  isHidden: boolean;                   // Hidden from UI
  syncVersion: number;                 // Optimistic locking

  // === TRANSACTION REFERENCES ===
  transactionIds: string[];            // Linked transaction IDs
}

// =======================
// API REQUEST/RESPONSE
// =======================

/**
 * Create User-Defined Recurring Outflow
 */
export interface CreateRecurringOutflowRequest {
  description: string;
  merchantName?: string;
  amount: number;                      // Will be stored as FLAT averageAmount
  frequency: 'weekly' | 'bi_weekly' | 'monthly' | 'quarterly' | 'yearly';
  expenseType?: ExpenseType;
  isEssential?: boolean;
  dueDay?: number;
  userNotes?: string;
  groupId?: string;                    // Single groupId from client
}

export interface CreateRecurringOutflowResponse {
  success: boolean;
  outflowId?: string;
  message?: string;
}

/**
 * Sync Recurring Transactions from Plaid
 */
export interface SyncRecurringTransactionsRequest {
  plaidItemId: string;
}

export interface SyncRecurringTransactionsResponse {
  success: boolean;
  inflowsCreated: number;
  inflowsUpdated: number;
  outflowsCreated: number;
  outflowsUpdated: number;
  errors: string[];
}
