/**
 * Handle Budget Date Changes Utility
 *
 * Manages period adjustments when budget date-related fields change:
 * - startDate: May add/remove periods at the beginning
 * - isOngoing: Changes from ongoing to limited or vice versa
 * - budgetEndDate: Sets when a budget should stop
 *
 * Strategy:
 * - Periods BEFORE new startDate → Mark inactive (preserve for history)
 * - Periods AFTER budgetEndDate → Mark inactive (preserve for history)
 * - Gaps in coverage → Generate new periods
 */
import * as admin from 'firebase-admin';
import { Budget } from '../../../types';
export interface DateChangeResult {
    success: boolean;
    startDateChange: {
        detected: boolean;
        periodsDeactivated: number;
        periodsGenerated: number;
    };
    endDateChange: {
        detected: boolean;
        periodsDeactivated: number;
        periodsReactivated: number;
    };
    errors: string[];
}
/**
 * Main function: Handle budget date-related changes
 *
 * @param db - Firestore instance
 * @param budgetId - The budget ID
 * @param budgetBefore - Budget data before update
 * @param budgetAfter - Budget data after update
 * @returns Result with change statistics
 */
export declare function handleBudgetDateChanges(db: admin.firestore.Firestore, budgetId: string, budgetBefore: Budget, budgetAfter: Budget): Promise<DateChangeResult>;
//# sourceMappingURL=handleBudgetDateChanges.d.ts.map