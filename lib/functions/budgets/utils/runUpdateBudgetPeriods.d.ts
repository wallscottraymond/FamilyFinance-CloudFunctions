/**
 * Update Budget Periods Utility
 *
 * Updates budget periods when parent budget changes.
 * Cascades field changes to current + future periods, preserving historical data.
 *
 * Handles the following field changes:
 * 1. name → Updates budgetName on current + future periods
 * 2. description → (Currently not stored on periods, but logged for future use)
 * 3. amount → Recalculates allocatedAmount on current + future periods
 * 4. alertThreshold → (Currently not stored on periods, but logged for future use)
 * 5. categoryIds → Handled separately by reassignTransactionsForBudget()
 *
 * Update Strategy:
 * - "Current + future" means: periods where periodEnd >= today
 * - Historical periods (periodEnd < today) are preserved
 * - Follows the same pattern as runUpdateInflowPeriods/runUpdateOutflowPeriods
 */
import * as admin from 'firebase-admin';
import { Budget } from '../../../types';
export interface BudgetUpdateResult {
    success: boolean;
    periodsQueried: number;
    periodsUpdated: number;
    periodsSkipped: number;
    fieldsUpdated: string[];
    errors: string[];
}
/**
 * Main function: Update all budget periods when parent budget changes
 *
 * @param db - Firestore instance
 * @param budgetId - The budget ID
 * @param budgetBefore - Budget data before update
 * @param budgetAfter - Budget data after update
 * @returns Result with update statistics
 */
export declare function runUpdateBudgetPeriods(db: admin.firestore.Firestore, budgetId: string, budgetBefore: Budget, budgetAfter: Budget): Promise<BudgetUpdateResult>;
//# sourceMappingURL=runUpdateBudgetPeriods.d.ts.map