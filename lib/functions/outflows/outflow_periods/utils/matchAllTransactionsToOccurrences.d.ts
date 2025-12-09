/**
 * Match All Transactions to Occurrences
 *
 * Centralized utility to match transaction splits to specific occurrence indices
 * within an outflow period. This enables per-occurrence payment tracking.
 *
 * TRIGGER-BASED ARCHITECTURE:
 * - Called from onOutflowPeriodCreate (initial matching)
 * - Called from onOutflowPeriodUpdate (when transactionSplits changes)
 * - Called from runUpdateOutflowPeriods (when parent outflow's transactionIds changes)
 *
 * MATCHING ALGORITHM:
 * - Finds closest occurrence due date to transaction date
 * - Uses 3-day tolerance window
 * - Updates parallel arrays: occurrencePaidFlags, occurrenceTransactionIds
 * - Calculates paid/unpaid counts
 *
 * IDEMPOTENT DESIGN:
 * - Safe to run multiple times (checks if changed before writing)
 * - Rebuilds occurrence arrays from scratch each time
 * - Prevents infinite trigger loops
 */
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { OutflowPeriod } from '../../../../types';
/**
 * Match all transaction splits in a period to specific occurrence indices
 *
 * @param db - Firestore instance
 * @param periodId - Outflow period document ID
 * @param periodData - Current outflow period data
 * @returns Promise that resolves when matching is complete
 *
 * @example
 * ```typescript
 * // Called from trigger
 * await matchAllTransactionsToOccurrences(db, periodId, periodData);
 * ```
 */
export declare function matchAllTransactionsToOccurrences(db: admin.firestore.Firestore, periodId: string, periodData: OutflowPeriod): Promise<void>;
/**
 * Find the occurrence index that best matches a transaction date
 *
 * MATCHING ALGORITHM:
 * - Finds the occurrence whose due date is CLOSEST to transaction date
 * - Must be within tolerance window (default 3 days)
 * - Returns null if no match within tolerance
 *
 * @param transactionDate - Date when transaction occurred
 * @param occurrenceDueDates - Array of occurrence due dates
 * @param tolerance - Maximum days difference allowed (default: 3)
 * @returns Index of matching occurrence, or null if no match
 *
 * @example
 * ```typescript
 * // Transaction on Jan 15, occurrences on Jan 1, 8, 15, 22
 * const index = findMatchingOccurrenceIndex(
 *   jan15Timestamp,
 *   [jan1, jan8, jan15, jan22]
 * );
 * // Returns: 2 (exact match to Jan 15)
 * ```
 */
export declare function findMatchingOccurrenceIndex(transactionDate: Timestamp, occurrenceDueDates: Timestamp[], tolerance?: number): number | null;
//# sourceMappingURL=matchAllTransactionsToOccurrences.d.ts.map