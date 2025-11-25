/**
 * Budget Periods Utility
 *
 * Centralized logic for creating and managing budget periods.
 * Handles the creation of budget_periods from source_periods with proper amount allocation.
 */
import * as admin from 'firebase-admin';
import { Budget, BudgetPeriodDocument } from '../types';
/**
 * Result of budget period creation
 */
export interface CreateBudgetPeriodsResult {
    budgetPeriods: BudgetPeriodDocument[];
    count: number;
    periodTypeCounts: {
        weekly: number;
        biMonthly: number;
        monthly: number;
    };
    firstPeriodId: string;
    lastPeriodId: string;
}
/**
 * Create budget periods from source periods
 *
 * Queries source_periods collection and creates budget_periods with proper amount allocation:
 * - Monthly: Full budget amount
 * - Bi-Monthly: Half budget amount (50%)
 * - Weekly: Proportional amount (7/30.44 of monthly)
 */
export declare function createBudgetPeriodsFromSource(db: admin.firestore.Firestore, budgetId: string, budget: Budget, startDate: Date, endDate: Date): Promise<CreateBudgetPeriodsResult>;
/**
 * Batch create budget periods in Firestore
 *
 * Efficiently creates multiple budget_periods using batch operations.
 * Handles Firestore's 500 document batch limit.
 */
export declare function batchCreateBudgetPeriods(db: admin.firestore.Firestore, budgetPeriods: BudgetPeriodDocument[]): Promise<void>;
/**
 * Update budget with period range metadata
 */
export declare function updateBudgetPeriodRange(db: admin.firestore.Firestore, budgetId: string, firstPeriodId: string, lastPeriodId: string, endDate: Date, isRecurring: boolean): Promise<void>;
//# sourceMappingURL=budgetPeriods.d.ts.map