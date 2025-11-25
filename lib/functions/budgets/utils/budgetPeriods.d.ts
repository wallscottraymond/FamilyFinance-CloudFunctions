/**
 * Budget Periods Utility
 *
 * Centralized logic for creating and managing budget periods.
 * Handles the creation of budget_periods from source_periods with proper amount allocation.
 */
import * as admin from 'firebase-admin';
import { Budget, BudgetPeriodDocument } from '../../../types';
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
 * Result of date range determination for budget period generation
 */
export interface BudgetPeriodDateRange {
    startDate: Date;
    endDate: Date;
    startPeriodId?: string;
}
/**
 * Determine the date range for budget period generation
 *
 * This function encapsulates the complex logic for determining when to start
 * and end budget period generation based on budget configuration.
 *
 * @param db - Firestore instance
 * @param budget - Budget blueprint document
 * @returns Date range for period generation
 */
export declare function determineBudgetPeriodDateRange(db: admin.firestore.Firestore, budget: Budget): Promise<BudgetPeriodDateRange>;
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
/**
 * Complete workflow for generating budget periods for a new budget
 *
 * This workflow function encapsulates the entire period generation process:
 * 1. Determine date range for period generation
 * 2. Create budget periods from source periods
 * 3. Batch create periods in Firestore
 * 4. Update budget with period range metadata
 *
 * @param db - Firestore instance
 * @param budgetId - Budget document ID
 * @param budget - Budget document data
 * @returns Result of period generation including count and period range
 */
export declare function generateBudgetPeriodsForNewBudget(db: admin.firestore.Firestore, budgetId: string, budget: Budget): Promise<CreateBudgetPeriodsResult>;
//# sourceMappingURL=budgetPeriods.d.ts.map