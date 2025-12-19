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
import { OutflowPeriod, OutflowOccurrence } from '../../../../types';

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
export async function matchAllTransactionsToOccurrences(
  db: admin.firestore.Firestore,
  periodId: string,
  periodData: OutflowPeriod
): Promise<void> {
  try {
    console.log(`[matchAllTransactionsToOccurrences] Matching transactions for period: ${periodId}`);

    // Step 1: Validate inputs
    if (!periodData.occurrenceDueDates || periodData.occurrenceDueDates.length === 0) {
      console.log(`[matchAllTransactionsToOccurrences] No occurrences to track for period ${periodId}, skipping`);
      return;
    }

    const splits = periodData.transactionSplits || [];
    console.log(`[matchAllTransactionsToOccurrences] Period has ${periodData.occurrenceDueDates.length} occurrences, ${splits.length} transaction splits`);

    // Step 2: Initialize occurrence arrays (rebuild from scratch)
    const updatedPaidFlags = new Array(periodData.occurrenceDueDates.length).fill(false);
    const updatedTransactionIds = new Array(periodData.occurrenceDueDates.length).fill(null);

    // Step 2a: Initialize or clone occurrence objects (NEW)
    const updatedOccurrences: OutflowOccurrence[] = periodData.occurrences
      ? JSON.parse(JSON.stringify(periodData.occurrences)) // Deep clone
      : periodData.occurrenceDueDates.map((dueDate, index) => ({
          id: `${periodId}_occ_${index}`,
          dueDate: dueDate,
          isPaid: false,
          transactionId: null,
          transactionSplitId: null,
          paymentDate: null,
          amountDue: periodData.amountPerOccurrence || 0,
          amountPaid: 0,
          paymentType: null,
          isAutoMatched: false,
          matchedAt: null,
          matchedBy: null,
        }));

    // Reset all occurrences to unpaid before matching
    updatedOccurrences.forEach(occ => {
      occ.isPaid = false;
      occ.transactionId = null;
      occ.transactionSplitId = null;
      occ.paymentDate = null;
      occ.amountPaid = 0;
      occ.paymentType = null;
      occ.isAutoMatched = false;
      occ.matchedAt = null;
      occ.matchedBy = null;
    });

    // Step 3: Match each transaction split to an occurrence index
    for (const split of splits) {
      const occurrenceIndex = findMatchingOccurrenceIndex(
        split.transactionDate,
        periodData.occurrenceDueDates
      );

      if (occurrenceIndex !== null) {
        // Update parallel arrays (legacy)
        updatedPaidFlags[occurrenceIndex] = true;
        updatedTransactionIds[occurrenceIndex] = split.transactionId;

        // Update occurrence object (NEW)
        updatedOccurrences[occurrenceIndex] = {
          ...updatedOccurrences[occurrenceIndex],
          isPaid: true,
          transactionId: split.transactionId,
          transactionSplitId: split.splitId,
          paymentDate: split.transactionDate,
          amountPaid: split.amount,
          paymentType: split.paymentType || 'regular',
          isAutoMatched: split.isAutoMatched || false,
          matchedAt: split.matchedAt || Timestamp.now(),
          matchedBy: split.matchedBy || 'system',
        };

        console.log(
          `[matchAllTransactionsToOccurrences] Matched transaction ${split.transactionId} ` +
          `to occurrence ${occurrenceIndex + 1} (ID: ${updatedOccurrences[occurrenceIndex].id}, ` +
          `due ${periodData.occurrenceDueDates[occurrenceIndex].toDate().toISOString().split('T')[0]})`
        );
      } else {
        console.warn(
          `[matchAllTransactionsToOccurrences] ⚠️  Could not match transaction ${split.transactionId} ` +
          `(date: ${split.transactionDate.toDate().toISOString().split('T')[0]}) to any occurrence within tolerance`
        );
      }
    }

    // Step 4: Calculate counts
    const paidCount = updatedPaidFlags.filter(flag => flag === true).length;
    const unpaidCount = updatedPaidFlags.length - paidCount;

    console.log(`[matchAllTransactionsToOccurrences] Result: ${paidCount}/${updatedPaidFlags.length} occurrences paid`);

    // Step 5: Check if anything changed (idempotent design)
    const currentPaidFlags = periodData.occurrencePaidFlags || [];
    const hasChanged = JSON.stringify(currentPaidFlags) !== JSON.stringify(updatedPaidFlags);

    if (!hasChanged) {
      console.log(`[matchAllTransactionsToOccurrences] No changes detected, skipping update`);
      return;
    }

    // Step 6: Update period document with BOTH patterns
    await db.collection('outflow_periods').doc(periodId).update({
      // NEW: Occurrence objects
      occurrences: updatedOccurrences,

      // LEGACY: Parallel arrays
      occurrencePaidFlags: updatedPaidFlags,
      occurrenceTransactionIds: updatedTransactionIds,
      numberOfOccurrencesPaid: paidCount,
      numberOfOccurrencesUnpaid: unpaidCount,

      updatedAt: admin.firestore.Timestamp.now()
    });

    console.log(`[matchAllTransactionsToOccurrences] ✓ Successfully updated occurrence arrays for period ${periodId}`);

  } catch (error) {
    console.error(`[matchAllTransactionsToOccurrences] ❌ Error matching transactions for period ${periodId}:`, error);
    throw error; // Re-throw to let caller handle
  }
}

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
export function findMatchingOccurrenceIndex(
  transactionDate: Timestamp,
  occurrenceDueDates: Timestamp[],
  tolerance: number = 3 // days
): number | null {
  // Validation
  if (!occurrenceDueDates || occurrenceDueDates.length === 0) {
    console.error('[findMatchingOccurrenceIndex] No occurrence dates provided');
    return null;
  }

  if (occurrenceDueDates.some(date => !date || !date.toMillis)) {
    console.error('[findMatchingOccurrenceIndex] Invalid date in occurrence array');
    return null;
  }

  // Find the occurrence whose due date is closest to transaction date
  let closestIndex = -1;
  let closestDiff = Infinity;

  for (let i = 0; i < occurrenceDueDates.length; i++) {
    const diff = Math.abs(
      transactionDate.toMillis() - occurrenceDueDates[i].toMillis()
    ) / (1000 * 60 * 60 * 24); // Convert milliseconds to days

    if (diff <= tolerance && diff < closestDiff) {
      closestDiff = diff;
      closestIndex = i;
    }
  }

  // Log warnings for ambiguous matches
  if (closestIndex >= 0 && closestDiff > 1) {
    console.warn(
      `[findMatchingOccurrenceIndex] Transaction date is ${closestDiff.toFixed(1)} days ` +
      `from nearest occurrence. Consider reviewing the match.`
    );
  }

  return closestIndex >= 0 ? closestIndex : null;
}
