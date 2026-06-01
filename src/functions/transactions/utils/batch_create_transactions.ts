/**
 * Batch Transaction Creation Utility
 *
 * Handles atomic batch writing of transactions and outflow period updates to Firestore.
 * This is the final step in the transaction processing pipeline.
 *
 * @module transactions/utils/batch_create_transactions
 */

import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { db } from '../../../index';
import { Transaction as FamilyTransaction } from '../../../types';
import { OutflowPeriodUpdate } from './match_transaction_splits_to_outflows';

/**
 * Batch create transactions and update outflow periods atomically
 *
 * Creates all transactions and applies outflow period updates in a single
 * batch operation for atomicity.
 *
 * @param transactions - Array of transactions to create
 * @param outflow_updates - Array of outflow period updates to apply
 * @returns Count of successfully created transactions
 */
export async function batch_create_transactions(
  transactions: FamilyTransaction[],
  outflow_updates: OutflowPeriodUpdate[]
): Promise<number> {
  console.log(`📦 [batch_create_transactions] Batch creating ${transactions.length} transactions and ${outflow_updates.length} outflow updates`);

  if (transactions.length === 0) {
    console.log(`⏭️ [batch_create_transactions] No transactions to create`);
    return 0;
  }

  const BATCH_SIZE = 500; // Firestore batch limit
  let total_created = 0;

  try {
    // Split into batches if needed
    for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const batch_transactions = transactions.slice(i, i + BATCH_SIZE);
      const batch_number = Math.floor(i / BATCH_SIZE) + 1;
      const total_batches = Math.ceil(transactions.length / BATCH_SIZE);

      console.log(`📦 [batch_create_transactions] Processing batch ${batch_number}/${total_batches} (${batch_transactions.length} transactions)`);

      // Add transactions to batch
      for (const transaction of batch_transactions) {
        // Use transactionId field as Firestore document ID
        const transaction_id = transaction.transactionId;
        const doc_ref = db.collection('transactions').doc(transaction_id);

        // Add createdAt and updatedAt timestamps
        const transaction_data = {
          ...transaction,
          id: transaction_id,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        };

        // 🔍 DIAGNOSTIC: Log period IDs before writing to Firestore
        console.log(`🔍🔍🔍 [batch_create_transactions] Transaction ${transaction_id} period IDs:`, {
          split_count: transaction_data.splits?.length,
          first_split_periods: transaction_data.splits?.[0] ? {
            monthly_period_id: transaction_data.splits[0].monthlyPeriodId,
            weekly_period_id: transaction_data.splits[0].weeklyPeriodId,
            bi_weekly_period_id: transaction_data.splits[0].biWeeklyPeriodId,
          } : 'NO SPLITS'
        });

        batch.set(doc_ref, transaction_data);
      }

      // Add outflow period updates to this batch (if any belong to this batch)
      // We'll apply all outflow updates in the first batch for simplicity
      if (i === 0 && outflow_updates.length > 0) {
        const updates_for_batch = outflow_updates.slice(0, Math.min(outflow_updates.length, BATCH_SIZE - batch_transactions.length));

        for (const update of updates_for_batch) {
          const period_ref = db.collection('outflow_periods').doc(update.period_id);

          // Add transaction split reference to the outflow period (convert to camelCase for Firestore)
          batch.update(period_ref, {
            transactionSplits: FieldValue.arrayUnion({
              transactionId: update.transaction_split_ref.transaction_id,
              splitId: update.transaction_split_ref.split_id,
              amount: update.transaction_split_ref.amount,
              paymentDate: update.transaction_split_ref.payment_date,
            }),
            status: 'paid', // Mark as paid when transaction is matched
            updatedAt: Timestamp.now()
          });
        }

        console.log(`📦 [batch_create_transactions] Added ${updates_for_batch.length} outflow period updates to batch`);
      }

      // Commit the batch
      await batch.commit();
      total_created += batch_transactions.length;

      console.log(`✅ [batch_create_transactions] Committed batch ${batch_number}/${total_batches}`);
    }

    // Handle remaining outflow updates if they didn't fit in transaction batches
    const remaining_updates = outflow_updates.slice(BATCH_SIZE - transactions.length);
    if (remaining_updates.length > 0) {
      console.log(`📦 [batch_create_transactions] Processing ${remaining_updates.length} remaining outflow updates`);

      for (let i = 0; i < remaining_updates.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const batch_updates = remaining_updates.slice(i, i + BATCH_SIZE);

        for (const update of batch_updates) {
          const period_ref = db.collection('outflow_periods').doc(update.period_id);

          batch.update(period_ref, {
            transactionSplits: FieldValue.arrayUnion({
              transactionId: update.transaction_split_ref.transaction_id,
              splitId: update.transaction_split_ref.split_id,
              amount: update.transaction_split_ref.amount,
              paymentDate: update.transaction_split_ref.payment_date,
            }),
            status: 'paid',
            updatedAt: Timestamp.now()
          });
        }

        await batch.commit();
        console.log(`✅ [batch_create_transactions] Committed outflow updates batch ${Math.floor(i / BATCH_SIZE) + 1}`);
      }
    }

    console.log(`✅ [batch_create_transactions] Successfully created ${total_created} transactions with ${outflow_updates.length} outflow updates`);

    return total_created;

  } catch (error) {
    console.error('[batch_create_transactions] Error in batch creation:', error);
    throw error; // Throw to indicate failure
  }
}

// Legacy export for backward compatibility
export { batch_create_transactions as batchCreateTransactions };
