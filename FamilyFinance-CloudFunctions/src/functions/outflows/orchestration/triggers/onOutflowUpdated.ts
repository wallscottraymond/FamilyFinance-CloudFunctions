/**
 * Outflow Update Trigger - Transaction ID Sync
 *
 * This Cloud Function automatically updates outflow_periods when an outflow is updated.
 * Primary trigger: Changes to the transactionIds array (new transactions from Plaid).
 *
 * Key Responsibilities:
 * - Detect when transactionIds array changes
 * - Query unpaid outflow_periods for this outflow
 * - Recalculate occurrence payment mappings
 * - Update tracking arrays (occurrencePaidFlags, occurrenceTransactionIds)
 * - Update financial totals (totalAmountPaid, totalAmountUnpaid)
 * - Update progress metrics (paymentProgressPercentage, dollarProgressPercentage)
 * - Update payment status (isFullyPaid, isPartiallyPaid)
 *
 * Memory: 512MiB, Timeout: 60s
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { RecurringOutflow, OutflowPeriod } from '../../../../types';

/**
 * Helper to check if transactionIds array changed
 */
function hasTransactionIdsChanged(before: any, after: any): boolean {
  const beforeIds = before?.transactionIds || [];
  const afterIds = after?.transactionIds || [];

  // Quick length check
  if (beforeIds.length !== afterIds.length) {
    return true;
  }

  // Deep equality check
  const beforeSet = new Set(beforeIds);
  const afterSet = new Set(afterIds);

  if (beforeSet.size !== afterSet.size) {
    return true;
  }

  for (const id of beforeSet) {
    if (!afterSet.has(id)) {
      return true;
    }
  }

  return false;
}

/**
 * Update a single outflow period with transaction mapping changes
 *
 * This function:
 * 1. Fetches the latest period data
 * 2. Matches transactionIds to occurrence due dates
 * 3. Updates tracking arrays and financial totals
 * 4. Recalculates progress metrics and payment status
 */
async function updateOutflowPeriodTransactions(
  db: admin.firestore.Firestore,
  periodDoc: admin.firestore.QueryDocumentSnapshot,
  newTransactionIds: string[]
): Promise<void> {
  const periodData = periodDoc.data() as OutflowPeriod;
  const periodId = periodDoc.id;

  console.log(`[updateOutflowPeriodTransactions] Processing period: ${periodId}`);

  // Determine which new transactions aren't already mapped
  const existingTransactionIds = periodData.occurrenceTransactionIds.filter(id => id !== null);
  const newlyAddedTransactionIds = newTransactionIds.filter(
    id => !existingTransactionIds.includes(id)
  );

  if (newlyAddedTransactionIds.length === 0) {
    console.log(`[updateOutflowPeriodTransactions] No new transactions to map for period: ${periodId}`);
    return;
  }

  console.log(`[updateOutflowPeriodTransactions] Found ${newlyAddedTransactionIds.length} new transaction(s) to map`);

  // For simplicity in this first implementation:
  // Map new transactions to the first unpaid occurrences in chronological order
  // Future enhancement: Match by transaction date proximity to due dates

  const updatedPaidFlags = [...periodData.occurrencePaidFlags];
  const updatedTransactionIds = [...periodData.occurrenceTransactionIds];

  let transactionIndex = 0;
  for (let i = 0; i < updatedPaidFlags.length && transactionIndex < newlyAddedTransactionIds.length; i++) {
    if (!updatedPaidFlags[i]) {
      // This occurrence is unpaid, map it to a transaction
      updatedPaidFlags[i] = true;
      updatedTransactionIds[i] = newlyAddedTransactionIds[transactionIndex];
      console.log(
        `[updateOutflowPeriodTransactions] Mapped transaction ${newlyAddedTransactionIds[transactionIndex]} ` +
        `to occurrence #${i + 1} (due: ${periodData.occurrenceDueDates[i].toDate().toISOString().split('T')[0]})`
      );
      transactionIndex++;
    }
  }

  // Recalculate metrics
  const numberOfOccurrencesPaid = updatedPaidFlags.filter(flag => flag).length;
  const numberOfOccurrencesUnpaid = periodData.numberOfOccurrencesInPeriod - numberOfOccurrencesPaid;

  const totalAmountPaid = numberOfOccurrencesPaid * periodData.amountPerOccurrence;
  const totalAmountUnpaid = periodData.totalAmountDue - totalAmountPaid;

  const paymentProgressPercentage = periodData.numberOfOccurrencesInPeriod > 0
    ? (numberOfOccurrencesPaid / periodData.numberOfOccurrencesInPeriod) * 100
    : 0;

  const dollarProgressPercentage = periodData.totalAmountDue > 0
    ? (totalAmountPaid / periodData.totalAmountDue) * 100
    : 0;

  const isFullyPaid = numberOfOccurrencesUnpaid === 0;
  const isPartiallyPaid = numberOfOccurrencesPaid > 0 && numberOfOccurrencesUnpaid > 0;

  // Find next unpaid due date
  let nextUnpaidDueDate: admin.firestore.Timestamp | null = null;
  for (let i = 0; i < updatedPaidFlags.length; i++) {
    if (!updatedPaidFlags[i]) {
      nextUnpaidDueDate = periodData.occurrenceDueDates[i];
      break;
    }
  }

  // Calculate if overdue based on first unpaid due date
  const isOverdue = nextUnpaidDueDate && nextUnpaidDueDate.toDate() < new Date();

  // Determine status
  let status = 'pending';
  if (isFullyPaid) {
    status = 'paid';
  } else if (isPartiallyPaid) {
    status = 'partially_paid';
  } else if (isOverdue) {
    status = 'overdue';
  }

  // Update the period document
  const now = admin.firestore.Timestamp.now();
  await periodDoc.ref.update({
    // Updated tracking arrays
    occurrencePaidFlags: updatedPaidFlags,
    occurrenceTransactionIds: updatedTransactionIds,
    numberOfOccurrencesPaid: numberOfOccurrencesPaid,
    numberOfOccurrencesUnpaid: numberOfOccurrencesUnpaid,

    // Updated financial totals
    totalAmountPaid: totalAmountPaid,
    totalAmountUnpaid: totalAmountUnpaid,

    // Updated progress metrics
    paymentProgressPercentage: Math.round(paymentProgressPercentage * 100) / 100,
    dollarProgressPercentage: Math.round(dollarProgressPercentage * 100) / 100,

    // Updated payment status
    isFullyPaid: isFullyPaid,
    isPartiallyPaid: isPartiallyPaid,
    isPaid: isFullyPaid, // Legacy field
    nextUnpaidDueDate: nextUnpaidDueDate,
    status: status,

    // Legacy fields
    amountDue: totalAmountUnpaid,

    // Audit trail
    updatedAt: now,
    lastCalculated: now,
    lastSyncedAt: now
  });

  console.log(
    `[updateOutflowPeriodTransactions] Updated period ${periodId}: ` +
    `${numberOfOccurrencesPaid}/${periodData.numberOfOccurrencesInPeriod} paid, ` +
    `$${totalAmountPaid.toFixed(2)}/$${periodData.totalAmountDue.toFixed(2)} (${status})`
  );
}

/**
 * Triggered when an outflow is updated
 * Automatically updates unpaid outflow_periods when transactionIds changes
 */
export const onOutflowUpdated = onDocumentUpdated({
  document: 'outflows/{outflowId}',
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 60,
}, async (event) => {
  try {
    const outflowId = event.params.outflowId;
    const beforeData = event.data?.before.data() as RecurringOutflow | undefined;
    const afterData = event.data?.after.data() as RecurringOutflow | undefined;

    if (!beforeData || !afterData) {
      console.error('[onOutflowUpdated] Missing before/after data');
      return;
    }

    console.log(`[onOutflowUpdated] Outflow updated: ${outflowId}`);

    // Check if transactionIds changed
    if (!hasTransactionIdsChanged(beforeData, afterData)) {
      console.log(`[onOutflowUpdated] No transactionIds changes detected for ${outflowId}, skipping`);
      return;
    }

    const newTransactionIds = (afterData as any).transactionIds || [];
    console.log(`[onOutflowUpdated] TransactionIds changed! Now has ${newTransactionIds.length} transaction(s)`);

    const db = admin.firestore();

    // Query unpaid outflow_periods for this outflow
    // Only update periods that are not fully paid
    const unpaidPeriodsQuery = db.collection('outflow_periods')
      .where('outflowId', '==', outflowId)
      .where('isFullyPaid', '==', false)
      .limit(100); // Reasonable limit for bulk updates

    const unpaidPeriodsSnapshot = await unpaidPeriodsQuery.get();

    if (unpaidPeriodsSnapshot.empty) {
      console.log(`[onOutflowUpdated] No unpaid periods found for outflow ${outflowId}`);
      return;
    }

    console.log(`[onOutflowUpdated] Found ${unpaidPeriodsSnapshot.size} unpaid period(s) to update`);

    // Update each unpaid period
    let updatedCount = 0;
    for (const periodDoc of unpaidPeriodsSnapshot.docs) {
      try {
        await updateOutflowPeriodTransactions(db, periodDoc, newTransactionIds);
        updatedCount++;
      } catch (error) {
        console.error(`[onOutflowUpdated] Error updating period ${periodDoc.id}:`, error);
        // Continue with other periods
      }
    }

    console.log(`[onOutflowUpdated] Successfully updated ${updatedCount}/${unpaidPeriodsSnapshot.size} period(s) for outflow ${outflowId}`);

  } catch (error) {
    console.error('[onOutflowUpdated] Error:', error);
    // Don't throw - we don't want to break outflow updates if period sync fails
  }
});
