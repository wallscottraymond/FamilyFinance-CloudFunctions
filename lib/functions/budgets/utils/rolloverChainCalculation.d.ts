/**
 * Rollover Chain Calculation Utility
 *
 * Calculates and persists rollover amounts for budget periods.
 * Rollover chains are calculated per period type (weekly→weekly, monthly→monthly).
 *
 * Key behaviors:
 * - Calculates rollover sequentially through the period chain
 * - Persists rolledOverAmount to each period document
 * - Updates remaining to include rollover (allocated + rollover - spent)
 * - Respects per-budget and global rollover settings
 */
import * as admin from 'firebase-admin';
import { PeriodType } from '../../../types';
export interface RolloverChainResult {
    success: boolean;
    periodsUpdated: number;
    periodsByType: {
        [key in PeriodType]?: number;
    };
    errors: string[];
}
/**
 * Recalculate rollover for all periods of a budget, starting from a specific period.
 *
 * @param db - Firestore instance
 * @param budgetId - The budget ID to recalculate
 * @param startFromPeriodId - Optional: Start recalculation from this period (for efficiency)
 * @param periodTypes - Optional: Only recalculate specific period types
 * @returns Result with counts and any errors
 */
export declare function recalculateRolloverChain(db: admin.firestore.Firestore, budgetId: string, startFromPeriodId?: string, periodTypes?: PeriodType[]): Promise<RolloverChainResult>;
/**
 * Recalculate rollover for periods that just became current.
 * Called by scheduled function to ensure rollover is calculated
 * even when no spending activity occurs.
 *
 * @param db - Firestore instance
 * @returns Count of budgets processed
 */
export declare function recalculateRolloverForCurrentPeriods(db: admin.firestore.Firestore): Promise<{
    budgetsProcessed: number;
    periodsUpdated: number;
    errors: string[];
}>;
//# sourceMappingURL=rolloverChainCalculation.d.ts.map