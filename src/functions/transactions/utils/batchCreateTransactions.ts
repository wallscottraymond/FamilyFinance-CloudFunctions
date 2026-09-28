/**
 * Batch Transaction Creation Utility
 *
 * Handles atomic batch writing of transactions and outflow period updates to Firestore.
 * This is the final step in the transaction processing pipeline.
 */

import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { db } from '../../../index';
import { Transaction as FamilyTransaction } from '../../../types';
import { OutflowPeriodUpdate } from './matchTransactionSplitsToOutflows';
import { bump_derive_version } from "../../repositories/derive_version.repo";

/**
 * Batch create transactions and update outflow periods atomically
 *
 * Creates all transactions and applies outflow period updates in a single
 * batch operation for atomicity.
 *
 * @param transactions - Array of transactions to create
 * @param outflowUpdates - Array of outflow period updates to apply
 * @returns Count of successfully created transactions
 */
export async function batchCreateTransactions(
  transactions: FamilyTransaction[],
  outflowUpdates: OutflowPeriodUpdate[]
): Promise<number> {
  console.log(`📦 [batchCreateTransactions] Batch creating ${transactions.length} transactions and ${outflowUpdates.length} outflow updates`);

  if (transactions.length === 0) {
    console.log(`⏭️ [batchCreateTransactions] No transactions to create`);
    return 0;
  }

  const BATCH_SIZE = 500; // Firestore batch limit
  let totalCreated = 0;

  try {
    // Split into batches if needed
    for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const batchTransactions = transactions.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(transactions.length / BATCH_SIZE);

      console.log(`📦 [batchCreateTransactions] Processing batch ${batchNumber}/${totalBatches} (${batchTransactions.length} transactions)`);

      // Add transactions to batch
      for (const transaction of batchTransactions) {
        // Use transactionId field as Firestore document ID
        const transactionId = transaction.transactionId;
        const docRef = db.collection('transactions').doc(transactionId);

        // Add createdAt and updatedAt timestamps
        const transactionData = {
          ...transaction,
          id: transactionId,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        };

        // 🔍 DIAGNOSTIC: Log period IDs before writing to Firestore
        console.log(`🔍🔍🔍 [batchCreateTransactions] Transaction ${transactionId} period IDs:`, {
          splitCount: transactionData.splits?.length,
          firstSplitPeriods: transactionData.splits?.[0] ? {
            monthlyPeriodId: transactionData.splits[0].monthlyPeriodId,
            weeklyPeriodId: transactionData.splits[0].weeklyPeriodId,
            biWeeklyPeriodId: transactionData.splits[0].biWeeklyPeriodId,
          } : 'NO SPLITS'
        });

        batch.set(docRef, transactionData);
      }

      // Add outflow period updates to this batch (if any belong to this batch)
      // We'll apply all outflow updates in the first batch for simplicity
      if (i === 0 && outflowUpdates.length > 0) {
        const updatesForBatch = outflowUpdates.slice(0, Math.min(outflowUpdates.length, BATCH_SIZE - batchTransactions.length));

        for (const update of updatesForBatch) {
          const periodRef = db.collection('outflow_periods').doc(update.periodId);

          // Add transaction split reference to the outflow period
          batch.update(periodRef, {
            transactionSplits: FieldValue.arrayUnion(update.transactionSplitRef),
            status: 'paid', // Mark as paid when transaction is matched
            updatedAt: Timestamp.now()
          });
        }

        console.log(`📦 [batchCreateTransactions] Added ${updatesForBatch.length} outflow period updates to batch`);
      }

      // Commit the batch
      await batch.commit();
      totalCreated += batchTransactions.length;

      console.log(`✅ [batchCreateTransactions] Committed batch ${batchNumber}/${totalBatches}`);
    }

    // Handle remaining outflow updates if they didn't fit in transaction batches
    const remainingUpdates = outflowUpdates.slice(BATCH_SIZE - transactions.length);
    if (remainingUpdates.length > 0) {
      console.log(`📦 [batchCreateTransactions] Processing ${remainingUpdates.length} remaining outflow updates`);

      for (let i = 0; i < remainingUpdates.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const batchUpdates = remainingUpdates.slice(i, i + BATCH_SIZE);

        for (const update of batchUpdates) {
          const periodRef = db.collection('outflow_periods').doc(update.periodId);

          batch.update(periodRef, {
            transactionSplits: FieldValue.arrayUnion(update.transactionSplitRef),
            status: 'paid',
            updatedAt: Timestamp.now()
          });
        }

        await batch.commit();
        console.log(`✅ [batchCreateTransactions] Committed outflow updates batch ${Math.floor(i / BATCH_SIZE) + 1}`);
      }
    }

    console.log(`✅ [batchCreateTransactions] Successfully created ${totalCreated} transactions with ${outflowUpdates.length} outflow updates`);

    // New transactions are a derive-input change — bump each owner's derive version once
    // (invalidates the derive cache AND is the mobile app's transaction-change signal).
    const owners = new Set(transactions.map((t) => t.ownerId).filter(Boolean) as string[]);
    await Promise.all([...owners].map((o) => bump_derive_version(o).catch(() => {})));

    return totalCreated;

  } catch (error) {
    console.error('[batchCreateTransactions] Error in batch creation:', error);
    throw error; // Throw to indicate failure
  }
}
