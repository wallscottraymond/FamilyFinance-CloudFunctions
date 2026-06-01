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
 *
 * @module transactions/utils/match_transaction_splits_to_outflows
 */

import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../../index';
import { Transaction as FamilyTransaction } from '../../../types';

/**
 * Result of outflow matching with both transactions and period updates
 */
export interface MatchOutflowsResult {
  transactions: FamilyTransaction[];
  outflow_updates: OutflowPeriodUpdate[];
}

/**
 * Outflow period update to be applied in batch
 */
export interface OutflowPeriodUpdate {
  period_id: string;
  transaction_split_ref: {
    transaction_id: string;
    split_id: string;
    amount: number;
    payment_date: Timestamp;
  };
}

/**
 * Match transaction splits to outflow periods (in-memory)
 *
 * Matches transactions to outflow periods and builds list of updates
 * to apply to outflow_periods collection in batch.
 *
 * @param transactions - Array of transactions to match
 * @param user_id - User ID for querying user-specific outflows
 * @returns Result with modified transactions and outflow period updates
 */
export async function match_transaction_splits_to_outflows(
  transactions: FamilyTransaction[],
  user_id: string
): Promise<MatchOutflowsResult> {
  console.log(`📝 [match_transaction_splits_to_outflows] Matching ${transactions.length} transaction splits to outflows`);

  const outflow_updates: OutflowPeriodUpdate[] = [];

  if (transactions.length === 0) {
    return { transactions, outflow_updates };
  }

  try {
    // Query all active outflow_periods for the user (within reasonable date range)
    const now = new Date();
    const three_months_ago = new Date(now);
    three_months_ago.setMonth(now.getMonth() - 3);
    const one_month_forward = new Date(now);
    one_month_forward.setMonth(now.getMonth() + 1);

    const outflow_periods_snapshot = await db.collection('outflow_periods')
      .where('userId', '==', user_id)
      .where('isDuePeriod', '==', true)
      .where('expectedDueDate', '>=', Timestamp.fromDate(three_months_ago))
      .where('expectedDueDate', '<=', Timestamp.fromDate(one_month_forward))
      .get();

    console.log(`📝 [match_transaction_splits_to_outflows] Found ${outflow_periods_snapshot.size} due outflow periods`);

    // Build outflow period lookup array
    const outflow_periods = outflow_periods_snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        outflow_id: data.outflowId,
        amount_due: data.amountDue || 0,
        expected_due_date: data.expectedDueDate ? (data.expectedDueDate as Timestamp).toMillis() : null,
        merchant_name: data.metadata?.outflowMerchantName || null,
        description: data.metadata?.outflowDescription || null,
        transaction_splits: data.transactionSplits || []
      };
    });

    // Process each transaction
    let matched_count = 0;
    transactions.forEach(transaction => {
      const txn_date = transaction.transactionDate.toMillis();
      const merchant_name = transaction.merchantName?.toLowerCase();

      // Try to match each split to an outflow period
      transaction.splits.forEach(split => {
        // Find best matching outflow period
        let best_match: typeof outflow_periods[0] | null = null;
        let best_score = 0;

        for (const period of outflow_periods) {
          // Skip if already fully paid (has existing transaction splits)
          if (period.transaction_splits && period.transaction_splits.length > 0) {
            continue;
          }

          let score = 0;

          // Merchant name matching (highest weight)
          if (merchant_name && period.merchant_name) {
            if (merchant_name.includes(period.merchant_name.toLowerCase()) ||
                period.merchant_name.toLowerCase().includes(merchant_name)) {
              score += 50;
            }
          }

          // Amount matching (within 10% tolerance)
          if (period.amount_due > 0) {
            const amount_diff = Math.abs(split.amount - period.amount_due);
            const amount_tolerance = period.amount_due * 0.1; // 10% tolerance
            if (amount_diff <= amount_tolerance) {
              score += 30;
            }
          }

          // Due date proximity (within 7 days)
          if (period.expected_due_date) {
            const days_diff = Math.abs(txn_date - period.expected_due_date) / (1000 * 60 * 60 * 24);
            if (days_diff <= 7) {
              score += 20 - (days_diff * 2); // Closer dates get higher scores
            }
          }

          // Update best match if this score is higher
          if (score > best_score && score >= 50) { // Minimum score threshold
            best_score = score;
            best_match = period;
          }
        }

        // If we found a match, update the split and create outflow update
        if (best_match) {
          split.outflowId = best_match.outflow_id;
          split.updatedAt = Timestamp.now();

          // Create outflow period update
          outflow_updates.push({
            period_id: best_match.id,
            transaction_split_ref: {
              transaction_id: transaction.transactionId,
              split_id: split.splitId,
              amount: split.amount,
              payment_date: transaction.transactionDate
            }
          });

          matched_count++;
          console.log(`  ✅ Matched split to outflow period ${best_match.id} (score: ${best_score})`);
        }
      });
    });

    console.log(`📝 [match_transaction_splits_to_outflows] Successfully matched ${matched_count} splits to outflow periods`);
    console.log(`📝 [match_transaction_splits_to_outflows] Created ${outflow_updates.length} outflow period updates`);

    return { transactions, outflow_updates };

  } catch (error) {
    console.error('[match_transaction_splits_to_outflows] Error matching splits to outflows:', error);
    return { transactions, outflow_updates }; // Return original data on error
  }
}

// Legacy interface exports for backward compatibility
export interface LegacyMatchOutflowsResult {
  transactions: FamilyTransaction[];
  outflowUpdates: Array<{
    periodId: string;
    transactionSplitRef: {
      transactionId: string;
      splitId: string;
      amount: number;
      paymentDate: Timestamp;
    };
  }>;
}

/**
 * Legacy wrapper that converts snake_case output to camelCase for backward compatibility
 */
export async function matchTransactionSplitsToOutflows(
  transactions: FamilyTransaction[],
  userId: string
): Promise<LegacyMatchOutflowsResult> {
  const result = await match_transaction_splits_to_outflows(transactions, userId);

  // Convert snake_case to camelCase for backward compatibility
  return {
    transactions: result.transactions,
    outflowUpdates: result.outflow_updates.map(update => ({
      periodId: update.period_id,
      transactionSplitRef: {
        transactionId: update.transaction_split_ref.transaction_id,
        splitId: update.transaction_split_ref.split_id,
        amount: update.transaction_split_ref.amount,
        paymentDate: update.transaction_split_ref.payment_date
      }
    }))
  };
}
