"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchAllTransactionsToOccurrences = matchAllTransactionsToOccurrences;
exports.findMatchingOccurrenceIndex = findMatchingOccurrenceIndex;
const admin = __importStar(require("firebase-admin"));
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
async function matchAllTransactionsToOccurrences(db, periodId, periodData) {
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
        // Step 3: Match each transaction split to an occurrence index
        for (const split of splits) {
            const occurrenceIndex = findMatchingOccurrenceIndex(split.transactionDate, periodData.occurrenceDueDates);
            if (occurrenceIndex !== null) {
                updatedPaidFlags[occurrenceIndex] = true;
                updatedTransactionIds[occurrenceIndex] = split.transactionId;
                console.log(`[matchAllTransactionsToOccurrences] Matched transaction ${split.transactionId} ` +
                    `to occurrence ${occurrenceIndex + 1} (due ${periodData.occurrenceDueDates[occurrenceIndex].toDate().toISOString().split('T')[0]})`);
            }
            else {
                console.warn(`[matchAllTransactionsToOccurrences] ⚠️  Could not match transaction ${split.transactionId} ` +
                    `(date: ${split.transactionDate.toDate().toISOString().split('T')[0]}) to any occurrence within tolerance`);
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
        // Step 6: Update period document
        await db.collection('outflow_periods').doc(periodId).update({
            occurrencePaidFlags: updatedPaidFlags,
            occurrenceTransactionIds: updatedTransactionIds,
            numberOfOccurrencesPaid: paidCount,
            numberOfOccurrencesUnpaid: unpaidCount,
            updatedAt: admin.firestore.Timestamp.now()
        });
        console.log(`[matchAllTransactionsToOccurrences] ✓ Successfully updated occurrence arrays for period ${periodId}`);
    }
    catch (error) {
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
function findMatchingOccurrenceIndex(transactionDate, occurrenceDueDates, tolerance = 3 // days
) {
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
        const diff = Math.abs(transactionDate.toMillis() - occurrenceDueDates[i].toMillis()) / (1000 * 60 * 60 * 24); // Convert milliseconds to days
        if (diff <= tolerance && diff < closestDiff) {
            closestDiff = diff;
            closestIndex = i;
        }
    }
    // Log warnings for ambiguous matches
    if (closestIndex >= 0 && closestDiff > 1) {
        console.warn(`[findMatchingOccurrenceIndex] Transaction date is ${closestDiff.toFixed(1)} days ` +
            `from nearest occurrence. Consider reviewing the match.`);
    }
    return closestIndex >= 0 ? closestIndex : null;
}
//# sourceMappingURL=matchAllTransactionsToOccurrences.js.map