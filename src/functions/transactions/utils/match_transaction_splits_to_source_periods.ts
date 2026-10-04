/**
 * Transaction Splits to Source Period Matching Utility (Batch In-Memory Processing)
 *
 * Maps transaction splits to source period IDs (monthly, weekly, bi-weekly).
 * Updates the monthlyPeriodId, weeklyPeriodId, and biWeeklyPeriodId fields
 * in each transaction split.
 *
 * This version operates in-memory on transaction arrays with batch period queries.
 *
 * @module transactions/utils/match_transaction_splits_to_source_periods
 */

import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../../index';
// No source period is longer than this (31d) — bounds the candidate startDate range.
import { SOURCE_PERIOD_OVERLAP_BUFFER_MS } from '../../repositories/source_period.repo';
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
export async function match_transaction_splits_to_source_periods(
  transactions: FamilyTransaction[]
): Promise<FamilyTransaction[]> {
  console.log(`🗓️🗓️🗓️ [match_transaction_splits_to_source_periods] === STARTING PERIOD MATCHING ===`);
  console.log(`🗓️🗓️🗓️ [match_transaction_splits_to_source_periods] Processing ${transactions.length} transactions`);

  if (transactions.length === 0) {
    console.log(`🗓️🗓️🗓️ [match_transaction_splits_to_source_periods] No transactions to process, returning empty array`);
    return transactions;
  }

  try {
    // Get all unique transaction dates
    const unique_dates = new Set<number>();
    transactions.forEach(txn => {
      unique_dates.add(txn.transactionDate.toMillis());
    });

    console.log(`🗓️🗓️🗓️ [match_transaction_splits_to_source_periods] Found ${unique_dates.size} unique transaction dates`);

    // Read ONLY the source periods that can contain these dates (Read-Cost-Review-Round-3 Q4):
    // a period contains date d iff startDate <= d <= endDate, and no period is longer than
    // 31 days, so startDate ∈ [min(d) − 31d, max(d)] covers every candidate. Was an
    // unfiltered `.get()` of the whole app-wide collection (~980 docs) up to twice per sync.
    // Same (startDate range + orderBy) shape as source_period_repo.get_overlapping (indexed).
    const date_list = Array.from(unique_dates);
    const min_date = Math.min(...date_list);
    const max_date = Math.max(...date_list);
    const periods_snapshot = await db.collection('source_periods')
      .where('startDate', '>=', Timestamp.fromMillis(min_date - SOURCE_PERIOD_OVERLAP_BUFFER_MS))
      .where('startDate', '<=', Timestamp.fromMillis(max_date))
      .orderBy('startDate', 'asc')
      .get();

    console.log(`🗓️🗓️🗓️ [match_transaction_splits_to_source_periods] ✅ FOUND ${periods_snapshot.size} candidate SOURCE PERIODS for the transaction dates`);

    if (periods_snapshot.size === 0) {
      console.error(`❌❌❌ [match_transaction_splits_to_source_periods] NO SOURCE PERIODS FOUND! Cannot match transactions to periods. Please run generateSourcePeriods.`);
      return transactions;
    }

    // Build a period lookup map
    const periods = periods_snapshot.docs.map(doc => ({
      id: doc.id,
      type: doc.data().type,
      start_date: (doc.data().startDate as Timestamp).toMillis(),
      end_date: (doc.data().endDate as Timestamp).toMillis()
    }));

    console.log(`🗓️🗓️🗓️ [match_transaction_splits_to_source_periods] Period types found: ${periods.slice(0, 5).map(p => p.type).join(', ')}`);
    console.log(`🗓️🗓️🗓️ [match_transaction_splits_to_source_periods] Sample period date ranges: ${periods.slice(0, 3).map(p => `${p.type}: ${new Date(p.start_date).toISOString()} to ${new Date(p.end_date).toISOString()}`).join(' | ')}`);

    // Process each transaction
    let matched_count = 0;
    transactions.forEach(transaction => {
      const txn_date = transaction.transactionDate.toMillis();
      console.log(`🗓️🗓️🗓️ [match_transaction_splits_to_source_periods] Processing transaction with date: ${new Date(txn_date).toISOString()} (${txn_date})`);

      // Find matching periods for this transaction date
      // Transaction date must be >= periodStartDate AND <= periodEndDate
      const matching_periods = periods.filter(period =>
        txn_date >= period.start_date && txn_date <= period.end_date
      );

      if (matching_periods.length > 0) {
        console.log(`  ✅✅✅ Transaction date ${new Date(txn_date).toISOString()} matched ${matching_periods.length} periods: ${matching_periods.map(p => `${p.type}(${p.id})`).join(', ')}`);
      } else {
        console.log(`  ❌❌❌ Transaction date ${new Date(txn_date).toISOString()} matched NO periods`);
      }

      // Extract period IDs by type
      const monthly_period = matching_periods.find(p => p.type === 'monthly');
      const weekly_period = matching_periods.find(p => p.type === 'weekly');
      const bi_weekly_period = matching_periods.find(p => p.type === 'bi_monthly'); // Fixed: was 'bi_weekly', should be 'bi_monthly'

      // Update all splits in the transaction with period IDs
      const updated_splits = transaction.splits.map(split => ({
        ...split,
        monthlyPeriodId: monthly_period?.id || null,
        weeklyPeriodId: weekly_period?.id || null,
        biWeeklyPeriodId: bi_weekly_period?.id || null,
        updatedAt: Timestamp.now()
      }));

      console.log(`🗓️🗓️🗓️ [match_transaction_splits_to_source_periods] Updated ${transaction.splits.length} splits with periods: monthly=${monthly_period?.id}, weekly=${weekly_period?.id}, biWeekly=${bi_weekly_period?.id}`);

      transaction.splits = updated_splits;

      if (matching_periods.length > 0) {
        matched_count++;
      }
    });

    console.log(`🗓️🗓️🗓️ [match_transaction_splits_to_source_periods] === PERIOD MATCHING COMPLETE ===`);
    console.log(`🗓️🗓️🗓️ [match_transaction_splits_to_source_periods] ✅ Successfully matched ${matched_count} of ${transactions.length} transactions to source periods`);

    return transactions;

  } catch (error) {
    console.error('[match_transaction_splits_to_source_periods] Error matching transaction splits to source periods:', error);
    return transactions; // Return original array on error
  }
}

// Legacy export for backward compatibility during migration
export { match_transaction_splits_to_source_periods as matchTransactionSplitsToSourcePeriods };
