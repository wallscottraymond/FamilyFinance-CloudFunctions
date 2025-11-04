/**
 * Transaction Splits to Source Period Matching Utility (Batch In-Memory Processing)
 *
 * Maps transaction splits to source period IDs (monthly, weekly, bi-weekly).
 * Updates the monthlyPeriodId, weeklyPeriodId, and biWeeklyPeriodId fields
 * in each transaction split.
 *
 * This version operates in-memory on transaction arrays with batch period queries.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../../index';
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
export async function matchTransactionSplitsToSourcePeriods(
  transactions: FamilyTransaction[]
): Promise<FamilyTransaction[]> {
  console.log(`🗓️🗓️🗓️ [matchTransactionSplitsToSourcePeriods] === STARTING PERIOD MATCHING ===`);
  console.log(`🗓️🗓️🗓️ [matchTransactionSplitsToSourcePeriods] Processing ${transactions.length} transactions`);

  if (transactions.length === 0) {
    console.log(`🗓️🗓️🗓️ [matchTransactionSplitsToSourcePeriods] No transactions to process, returning empty array`);
    return transactions;
  }

  try {
    // Get all unique transaction dates
    const uniqueDates = new Set<number>();
    transactions.forEach(txn => {
      uniqueDates.add(txn.transactionDate.toMillis());
    });

    console.log(`🗓️🗓️🗓️ [matchTransactionSplitsToSourcePeriods] Found ${uniqueDates.size} unique transaction dates`);

    // Query ALL source periods (they are app-wide, not user-specific)
    // We'll filter in memory based on transaction dates
    console.log(`🗓️🗓️🗓️ [matchTransactionSplitsToSourcePeriods] Querying ALL source_periods collection...`);
    const periodsSnapshot = await db.collection('source_periods')
      .get();

    console.log(`🗓️🗓️🗓️ [matchTransactionSplitsToSourcePeriods] ✅ FOUND ${periodsSnapshot.size} SOURCE PERIODS (app-wide)`);

    if (periodsSnapshot.size === 0) {
      console.error(`❌❌❌ [matchTransactionSplitsToSourcePeriods] NO SOURCE PERIODS FOUND! Cannot match transactions to periods. Please run generateSourcePeriods.`);
      return transactions;
    }

    // Build a period lookup map
    const periods = periodsSnapshot.docs.map(doc => ({
      id: doc.id,
      type: doc.data().type,
      startDate: (doc.data().startDate as Timestamp).toMillis(),
      endDate: (doc.data().endDate as Timestamp).toMillis()
    }));

    console.log(`🗓️🗓️🗓️ [matchTransactionSplitsToSourcePeriods] Period types found: ${periods.slice(0, 5).map(p => p.type).join(', ')}`);
    console.log(`🗓️🗓️🗓️ [matchTransactionSplitsToSourcePeriods] Sample period date ranges: ${periods.slice(0, 3).map(p => `${p.type}: ${new Date(p.startDate).toISOString()} to ${new Date(p.endDate).toISOString()}`).join(' | ')}`);

    // Process each transaction
    let matchedCount = 0;
    transactions.forEach(transaction => {
      const txnDate = transaction.transactionDate.toMillis();
      console.log(`🗓️🗓️🗓️ [matchTransactionSplitsToSourcePeriods] Processing transaction with date: ${new Date(txnDate).toISOString()} (${txnDate})`);

      // Find matching periods for this transaction date
      // Transaction date must be >= periodStartDate AND <= periodEndDate
      const matchingPeriods = periods.filter(period =>
        txnDate >= period.startDate && txnDate <= period.endDate
      );

      if (matchingPeriods.length > 0) {
        console.log(`  ✅✅✅ Transaction date ${new Date(txnDate).toISOString()} matched ${matchingPeriods.length} periods: ${matchingPeriods.map(p => `${p.type}(${p.id})`).join(', ')}`);
      } else {
        console.log(`  ❌❌❌ Transaction date ${new Date(txnDate).toISOString()} matched NO periods`);
      }

      // Extract period IDs by type
      const monthlyPeriod = matchingPeriods.find(p => p.type === 'monthly');
      const weeklyPeriod = matchingPeriods.find(p => p.type === 'weekly');
      const biWeeklyPeriod = matchingPeriods.find(p => p.type === 'bi_weekly');

      // Update all splits in the transaction with period IDs
      const updatedSplits = transaction.splits.map(split => ({
        ...split,
        monthlyPeriodId: monthlyPeriod?.id || null,
        weeklyPeriodId: weeklyPeriod?.id || null,
        biWeeklyPeriodId: biWeeklyPeriod?.id || null,
        updatedAt: Timestamp.now()
      }));

      console.log(`🗓️🗓️🗓️ [matchTransactionSplitsToSourcePeriods] Updated ${transaction.splits.length} splits with periods: monthly=${monthlyPeriod?.id}, weekly=${weeklyPeriod?.id}, biWeekly=${biWeeklyPeriod?.id}`);

      transaction.splits = updatedSplits;

      if (matchingPeriods.length > 0) {
        matchedCount++;
      }
    });

    console.log(`🗓️🗓️🗓️ [matchTransactionSplitsToSourcePeriods] === PERIOD MATCHING COMPLETE ===`);
    console.log(`🗓️🗓️🗓️ [matchTransactionSplitsToSourcePeriods] ✅ Successfully matched ${matchedCount} of ${transactions.length} transactions to source periods`);

    return transactions;

  } catch (error) {
    console.error('[matchTransactionSplitsToSourcePeriods] Error matching transaction splits to source periods:', error);
    return transactions; // Return original array on error
  }
}
