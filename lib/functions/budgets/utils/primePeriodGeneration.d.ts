/**
 * Prime Period Generation Utility
 *
 * Generates "prime" budget periods that match the budget's period type.
 * Prime periods are the authoritative source for budget allocation calculations.
 * Non-prime periods derive their amounts from overlapping prime periods.
 */
import * as admin from 'firebase-admin';
import { Budget, BudgetPeriodDocument, PeriodType, BudgetPeriod } from '../../../types';
/**
 * Maps a Budget's period field to the corresponding PeriodType
 *
 * @param budgetPeriod - The budget's period field (WEEKLY, MONTHLY, etc.)
 * @returns The corresponding PeriodType for prime period generation
 */
export declare function getPrimePeriodType(budgetPeriod: BudgetPeriod): PeriodType;
/**
 * Returns the non-prime period types that should be generated for a budget
 *
 * @param budgetPeriod - The budget's period field
 * @returns Array of PeriodTypes that are non-prime for this budget
 */
export declare function getNonPrimePeriodTypes(budgetPeriod: BudgetPeriod): PeriodType[];
/**
 * Generate prime budget periods from source periods
 *
 * Prime periods:
 * - Match the budget's period type (budget.period)
 * - Have isPrime = true
 * - Calculate dailyRate = allocatedAmount / daysInPeriod
 * - Handle partial first/last periods (budget start/end mid-period)
 *
 * @param db - Firestore instance
 * @param budgetId - Budget document ID
 * @param budget - Budget document
 * @param startDate - Budget start date
 * @param endDate - Budget end date (for limited budgets) or 1 year from start (recurring)
 * @returns Array of prime budget period documents (not yet saved to Firestore)
 */
export declare function generatePrimeBudgetPeriods(db: admin.firestore.Firestore, budgetId: string, budget: Budget, startDate: Date, endDate: Date): Promise<BudgetPeriodDocument[]>;
//# sourceMappingURL=primePeriodGeneration.d.ts.map