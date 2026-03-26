/**
 * Non-Prime Period Generation Utility
 *
 * Generates "non-prime" budget periods that derive their allocated amounts
 * from overlapping prime periods using daily rate lookups.
 *
 * Algorithm (SUMPRODUCT equivalent):
 * For each day in the non-prime period:
 *   - Find which prime period contains that day
 *   - Get that prime's dailyRate
 *   - Add to running total
 */
import * as admin from 'firebase-admin';
import { Budget, BudgetPeriodDocument, PeriodType, PrimePeriodContribution } from '../../../types';
/**
 * Find all prime periods that overlap with the target date range
 *
 * @param targetStart - Target period start date
 * @param targetEnd - Target period end date
 * @param sortedPrimePeriods - Array of prime periods sorted by periodStart (ascending)
 * @returns Array of overlapping prime periods
 */
export declare function findOverlappingPrimePeriods(targetStart: Date, targetEnd: Date, sortedPrimePeriods: BudgetPeriodDocument[]): BudgetPeriodDocument[];
/**
 * Calculate prime period contributions to a non-prime period
 *
 * Uses a day-by-day SUMPRODUCT approach:
 * - For each day in the target period
 * - Find which prime period contains that day
 * - Get that prime's daily rate
 * - Add to running total
 *
 * @param targetStart - Target period start date
 * @param targetEnd - Target period end date
 * @param overlappingPrimes - Prime periods that overlap with target
 * @returns Total allocated amount and detailed breakdown
 */
export declare function calculatePrimeContributions(targetStart: Date, targetEnd: Date, overlappingPrimes: BudgetPeriodDocument[]): {
    totalAmount: number;
    breakdown: PrimePeriodContribution[];
};
/**
 * Generate non-prime budget periods for a specific period type
 *
 * Non-prime periods:
 * - Do NOT match the budget's period type
 * - Have isPrime = false
 * - Derive allocatedAmount from overlapping prime periods
 * - Include primePeriodIds and primePeriodBreakdown
 *
 * @param db - Firestore instance
 * @param budgetId - Budget document ID
 * @param budget - Budget document
 * @param primePeriods - Array of prime periods (MUST be sorted by periodStart)
 * @param startDate - Budget start date
 * @param endDate - Budget end date
 * @param targetPeriodType - The non-prime period type to generate
 * @returns Array of non-prime budget period documents (not yet saved to Firestore)
 */
export declare function generateNonPrimeBudgetPeriods(db: admin.firestore.Firestore, budgetId: string, budget: Budget, primePeriods: BudgetPeriodDocument[], startDate: Date, endDate: Date, targetPeriodType: PeriodType): Promise<BudgetPeriodDocument[]>;
//# sourceMappingURL=nonPrimePeriodGeneration.d.ts.map