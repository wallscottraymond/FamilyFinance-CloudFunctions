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
/**
 * Outflow Status (from Plaid)
 */
export declare enum OutflowStatus {
    MATURE = "MATURE",// Has at least 3 transactions
    EARLY_DETECTION = "EARLY_DETECTION"
}
/**
 * Outflow Frequency (standardized Plaid format)
 */
export declare enum OutflowFrequency {
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
    id: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    userId: string;
    groupId: string;
    isActive: boolean;
    status: OutflowStatus;
    streamId: string;
    itemId: string;
    accountId: string;
    averageAmount: number;
    lastAmount: number;
    currency: string;
    unofficialCurrency: string | null;
    description: string;
    merchantName: string | null;
    category: string[];
    personalFinanceCategory: any | null;
    frequency: OutflowFrequency;
    firstDate: Timestamp;
    lastDate: Timestamp;
    predictedNextDate?: Timestamp;
    expenseType: ExpenseType;
    isEssential: boolean;
    merchantCategory: string | null;
    isCancellable: boolean;
    reminderDays: number;
    isHidden: boolean;
    syncVersion: number;
    transactionIds: string[];
}
/**
 * Create User-Defined Recurring Outflow
 */
export interface CreateRecurringOutflowRequest {
    description: string;
    merchantName?: string;
    amount: number;
    frequency: 'weekly' | 'bi_weekly' | 'monthly' | 'quarterly' | 'yearly';
    expenseType?: ExpenseType;
    isEssential?: boolean;
    dueDay?: number;
    userNotes?: string;
    groupId?: string;
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
//# sourceMappingURL=index.d.ts.map