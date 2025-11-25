/**
 * Transaction Splits to Source Period Matching Utility (Batch In-Memory Processing)
 *
 * Maps transaction splits to source period IDs (monthly, weekly, bi-weekly).
 * Updates the monthlyPeriodId, weeklyPeriodId, and biWeeklyPeriodId fields
 * in each transaction split.
 *
 * This version operates in-memory on transaction arrays with batch period queries.
 */
import { Transaction as FamilyTransaction } from '../../../types';
/**
 * Match transaction splits to source periods (batch in-memory processing)
 *
 * IMPORTANT: This function MUST be called for every transaction to map source period IDs.
 * It is independent of budget and outflow matching.
 *
 * SOURCE PERIODS ARE APP-WIDE (not user-specific). The function queries all source_periods
 * and matches them based on transaction dates only.
 *
 * Queries all source periods in one batch operation,
 * then updates EVERY split in EVERY transaction with period IDs in the fields:
 * - monthlyPeriodId
 * - weeklyPeriodId
 * - biWeeklyPeriodId
 *
 * @param transactions - Array of transactions to match
 * @returns Modified array of transactions with period IDs populated in ALL splits
 */
export declare function matchTransactionSplitsToSourcePeriods(transactions: FamilyTransaction[]): Promise<FamilyTransaction[]>;
//# sourceMappingURL=matchTransactionSplitsToSourcePeriods.d.ts.map