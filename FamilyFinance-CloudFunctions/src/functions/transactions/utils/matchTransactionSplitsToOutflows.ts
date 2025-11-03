/**
 * Transaction Splits to Outflows Matching Utility (In-Memory Processing)
 *
 * Matches transaction splits to outflow periods based on:
 * - Merchant name matching
 * - Amount matching (within tolerance)
 * - Due date proximity
 *
 * Operates in-memory on transaction arrays (no DB writes).
 * Returns both modified transactions and outflow period updates for batching.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../../index';
import { Transaction as FamilyTransaction } from '../../../types';

/**
 * Result of outflow matching with both transactions and period updates
 */
export interface MatchOutflowsResult {
  transactions: FamilyTransaction[];
  outflowUpdates: OutflowPeriodUpdate[];
}

/**
 * Outflow period update to be applied in batch
 */
export interface OutflowPeriodUpdate {
  periodId: string;
  transactionSplitRef: {
    transactionId: string;
    splitId: string;
    amount: number;
    paymentDate: Timestamp;
  };
}

/**
 * Match transaction splits to outflow periods (in-memory)
 *
 * Matches transactions to outflow periods and builds list of updates
 * to apply to outflow_periods collection in batch.
 *
 * @param transactions - Array of transactions to match
 * @param userId - User ID for querying user-specific outflows
 * @returns Result with modified transactions and outflow period updates
 */
export async function matchTransactionSplitsToOutflows(
  transactions: FamilyTransaction[],
  userId: string
): Promise<MatchOutflowsResult> {
  console.log(`📝 [matchTransactionSplitsToOutflows] Matching ${transactions.length} transaction splits to outflows`);

  const outflowUpdates: OutflowPeriodUpdate[] = [];

  if (transactions.length === 0) {
    return { transactions, outflowUpdates };
  }

  try {
    // Query all active outflow_periods for the user (within reasonable date range)
    const now = new Date();
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(now.getMonth() - 3);
    const oneMonthForward = new Date(now);
    oneMonthForward.setMonth(now.getMonth() + 1);

    const outflowPeriodsSnapshot = await db.collection('outflow_periods')
      .where('userId', '==', userId)
      .where('isDuePeriod', '==', true)
      .where('expectedDueDate', '>=', Timestamp.fromDate(threeMonthsAgo))
      .where('expectedDueDate', '<=', Timestamp.fromDate(oneMonthForward))
      .get();

    console.log(`📝 [matchTransactionSplitsToOutflows] Found ${outflowPeriodsSnapshot.size} due outflow periods`);

    // Build outflow period lookup array
    const outflowPeriods = outflowPeriodsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        outflowId: data.outflowId,
        amountDue: data.amountDue || 0,
        expectedDueDate: data.expectedDueDate ? (data.expectedDueDate as Timestamp).toMillis() : null,
        merchantName: data.metadata?.outflowMerchantName || null,
        description: data.metadata?.outflowDescription || null,
        transactionSplits: data.transactionSplits || []
      };
    });

    // Process each transaction
    let matchedCount = 0;
    transactions.forEach(transaction => {
      const txnDate = transaction.date.toMillis();
      const merchantName = transaction.metadata?.plaidMerchantName?.toLowerCase();

      // Try to match each split to an outflow period
      transaction.splits.forEach(split => {
        // Find best matching outflow period
        let bestMatch: typeof outflowPeriods[0] | null = null;
        let bestScore = 0;

        for (const period of outflowPeriods) {
          // Skip if already fully paid (has existing transaction splits)
          if (period.transactionSplits && period.transactionSplits.length > 0) {
            continue;
          }

          let score = 0;

          // Merchant name matching (highest weight)
          if (merchantName && period.merchantName) {
            if (merchantName.includes(period.merchantName.toLowerCase()) ||
                period.merchantName.toLowerCase().includes(merchantName)) {
              score += 50;
            }
          }

          // Amount matching (within 10% tolerance)
          if (period.amountDue > 0) {
            const amountDiff = Math.abs(split.amount - period.amountDue);
            const amountTolerance = period.amountDue * 0.1; // 10% tolerance
            if (amountDiff <= amountTolerance) {
              score += 30;
            }
          }

          // Due date proximity (within 7 days)
          if (period.expectedDueDate) {
            const daysDiff = Math.abs(txnDate - period.expectedDueDate) / (1000 * 60 * 60 * 24);
            if (daysDiff <= 7) {
              score += 20 - (daysDiff * 2); // Closer dates get higher scores
            }
          }

          // Update best match if this score is higher
          if (score > bestScore && score >= 50) { // Minimum score threshold
            bestScore = score;
            bestMatch = period;
          }
        }

        // If we found a match, update the split and create outflow update
        if (bestMatch) {
          split.outflowId = bestMatch.outflowId;
          split.updatedAt = Timestamp.now();

          // Create outflow period update
          outflowUpdates.push({
            periodId: bestMatch.id,
            transactionSplitRef: {
              transactionId: transaction.id || '',
              splitId: split.id,
              amount: split.amount,
              paymentDate: transaction.date
            }
          });

          matchedCount++;
          console.log(`  ✅ Matched split to outflow period ${bestMatch.id} (score: ${bestScore})`);
        }
      });
    });

    console.log(`📝 [matchTransactionSplitsToOutflows] Successfully matched ${matchedCount} splits to outflow periods`);
    console.log(`📝 [matchTransactionSplitsToOutflows] Created ${outflowUpdates.length} outflow period updates`);

    return { transactions, outflowUpdates };

  } catch (error) {
    console.error('[matchTransactionSplitsToOutflows] Error matching splits to outflows:', error);
    return { transactions, outflowUpdates }; // Return original data on error
  }
}
