// @ts-nocheck
/**
 * Auto-Match Transaction Splits to Outflow Periods
 *
 * Automatically matches an outflow's historical transactions to appropriate outflow periods.
 * Called by onOutflowCreated trigger after periods are generated.
 *
 * Matching logic:
 * 1. Get all transactions referenced in outflow.transactionIds
 * 2. For each transaction, find the matching outflow period based on transaction date
 * 3. For each split in the transaction, assign it to the appropriate outflow period
 * 4. Determine payment type (regular, catch_up, advance, extra_principal)
 * 5. Update transaction split with outflow assignment
 * 6. Add TransactionSplitReference to outflow period
 * 7. Recalculate outflow period statuses
 */

import * as admin from 'firebase-admin';
import { Timestamp, FieldPath } from 'firebase-admin/firestore';
import {
  RecurringOutflow,
  Transaction,
  TransactionSplit,
  TransactionSplitReference,
  OutflowPeriod,
  PaymentType
} from '../../../types';
import { calculateOutflowPeriodStatus } from './calculateOutflowPeriodStatus';

/**
 * Result of auto-matching operation
 */
export interface AutoMatchResult {
  transactionsProcessed: number;
  splitsAssigned: number;
  periodsUpdated: number;
  errors: string[];
}

/**
 * Automatically match outflow's historical transactions to outflow periods
 *
 * @param db - Firestore instance
 * @param outflowId - The outflow document ID
 * @param outflow - The recurring outflow data
 * @param createdPeriodIds - Array of outflow period IDs that were just created
 * @returns Result with counts of matches and any errors
 */
export async function autoMatchTransactionToOutflowPeriods(
  db: admin.firestore.Firestore,
  outflowId: string,
  outflow: RecurringOutflow,
  createdPeriodIds: string[]
): Promise<AutoMatchResult> {
  const result: AutoMatchResult = {
    transactionsProcessed: 0,
    splitsAssigned: 0,
    periodsUpdated: 0,
    errors: []
  };

  try {
    console.log(`[autoMatch] Starting auto-match for outflow ${outflowId}, ${outflow.transactionIds.length} transactions`);

    // Check if there are any transactions to match
    if (!outflow.transactionIds || outflow.transactionIds.length === 0) {
      console.log(`[autoMatch] No transaction IDs in outflow, skipping auto-match`);
      return result;
    }

    // Step 1: Get all outflow periods that were just created
    const outflowPeriods = await getOutflowPeriods(db, createdPeriodIds);
    if (outflowPeriods.length === 0) {
      console.warn(`[autoMatch] No outflow periods found with IDs: ${createdPeriodIds.join(', ')}`);
      return result;
    }

    console.log(`[autoMatch] Found ${outflowPeriods.length} outflow periods to match against`);

    // Step 2: Get all transactions referenced in transactionIds array
    // Note: transactionIds are Plaid transaction IDs, which are now used as document IDs
    const transactions = await getTransactionsByPlaidIds(db, outflow.transactionIds, outflow.userId || outflow.ownerId || '');
    console.log(`[autoMatch] Found ${transactions.length} transactions to process`);

    // Step 3: For each transaction, match splits to appropriate outflow periods
    for (const transaction of transactions) {
      try {
        await matchTransactionToOutflowPeriods(
          db,
          transaction,
          outflow,
          outflowPeriods,
          result
        );
        result.transactionsProcessed++;
      } catch (error) {
        const errorMsg = `Failed to match transaction ${transaction.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        result.errors.push(errorMsg);
        console.error(`[autoMatch] ${errorMsg}`);
      }
    }

    console.log(`[autoMatch] Auto-match complete: ${result.splitsAssigned} splits assigned to ${result.periodsUpdated} periods`);

    return result;
  } catch (error) {
    const errorMsg = `Auto-match failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    result.errors.push(errorMsg);
    console.error(`[autoMatch] ${errorMsg}`);
    return result;
  }
}

/**
 * Get outflow periods by IDs
 */
async function getOutflowPeriods(
  db: admin.firestore.Firestore,
  periodIds: string[]
): Promise<OutflowPeriod[]> {
  if (periodIds.length === 0) return [];

  const periods: OutflowPeriod[] = [];

  // Firestore 'in' queries are limited to 10 items, so batch if needed
  const BATCH_SIZE = 10;
  for (let i = 0; i < periodIds.length; i += BATCH_SIZE) {
    const batchIds = periodIds.slice(i, i + BATCH_SIZE);
    const snapshot = await db.collection('outflow_periods')
      .where(admin.firestore.FieldPath.documentId(), 'in', batchIds)
      .get();

    snapshot.docs.forEach(doc => {
      periods.push({ id: doc.id, ...doc.data() } as OutflowPeriod);
    });
  }

  return periods;
}

/**
 * Get transactions by Plaid transaction IDs
 *
 * Handles both old and new transaction formats:
 * - NEW: Plaid transaction ID is the document ID
 * - OLD: Plaid transaction ID is in metadata.plaidTransactionId
 */
async function getTransactionsByPlaidIds(
  db: admin.firestore.Firestore,
  plaidTransactionIds: string[],
  userId: string
): Promise<Transaction[]> {
  if (plaidTransactionIds.length === 0) return [];

  const transactions: Transaction[] = [];
  const foundIds = new Set<string>();

  // Firestore 'in' queries are limited to 10 items, so batch if needed
  const BATCH_SIZE = 10;
  for (let i = 0; i < plaidTransactionIds.length; i += BATCH_SIZE) {
    const batchIds = plaidTransactionIds.slice(i, i + BATCH_SIZE);

    // FIRST: Try to fetch transactions directly by document ID (NEW format)
    // Use getAll() for efficient batch reading instead of Promise.all with individual gets
    const docRefs = batchIds.map(id => db.collection('transactions').doc(id));
    const docs = await db.getAll(...docRefs);

    docs.forEach(doc => {
      if (doc.exists) {
        const data = doc.data();
        // Verify it belongs to the same user
        if (data && data.userId === userId) {
          transactions.push({ id: doc.id, ...data } as Transaction);
          foundIds.add(doc.id);
        }
      }
    });

    // SECOND: For any IDs not found, query by metadata.plaidTransactionId (OLD format)
    const notFoundIds = batchIds.filter(id => !foundIds.has(id));
    if (notFoundIds.length > 0) {
      const querySnapshot = await db.collection('transactions')
        .where('userId', '==', userId)
        .where('metadata.plaidTransactionId', 'in', notFoundIds)
        .get();

      querySnapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data && !foundIds.has(doc.id)) {
          transactions.push({ id: doc.id, ...data } as Transaction);
          foundIds.add(doc.id);
        }
      });
    }
  }

  console.log(`[getTransactionsByPlaidIds] Found ${transactions.length} transactions out of ${plaidTransactionIds.length} requested`);

  return transactions;
}

/**
 * Match a single transaction to outflow periods
 *
 * IMPORTANT: This function must assign splits to ALL THREE period types
 * (monthly, weekly, bi-weekly) to maintain consistency across period views.
 */
async function matchTransactionToOutflowPeriods(
  db: admin.firestore.Firestore,
  transaction: Transaction,
  outflow: RecurringOutflow,
  outflowPeriods: OutflowPeriod[],
  result: AutoMatchResult
): Promise<void> {
  // Find ALL THREE matching period types (monthly, weekly, bi-weekly)
  const matchingPeriods = findAllMatchingOutflowPeriods(transaction.date, outflowPeriods);

  if (matchingPeriods.foundCount === 0) {
    console.warn(`[autoMatch] No matching periods found for transaction ${transaction.id} dated ${transaction.date.toDate().toISOString()}`);
    return;
  }

  console.log(`[autoMatch] Matching transaction ${transaction.id} to ${matchingPeriods.foundCount} periods`);

  // Process each split in the transaction
  for (const split of transaction.splits) {
    // Skip if already assigned to budget or another outflow
    if ((split.budgetId && split.budgetId !== '' && split.budgetId !== 'unassigned') || split.outflowPeriodId) {
      console.log(`[autoMatch] Split ${split.id} already assigned, skipping`);
      continue;
    }

    // Determine payment type (use monthly period if available, otherwise first found)
    const primaryPeriod = matchingPeriods.monthlyPeriod ||
                         matchingPeriods.weeklyPeriod ||
                         matchingPeriods.biWeeklyPeriod;

    if (!primaryPeriod) {
      console.warn(`[autoMatch] No primary period found for split ${split.id}`);
      continue;
    }

    const paymentType = determinePaymentType(
      split.amount,
      transaction.date,
      primaryPeriod
    );

    // Create TransactionSplitReference for each period type
    const splitRef: TransactionSplitReference = {
      transactionId: transaction.id!,
      splitId: split.id,
      transactionDate: transaction.date,
      amount: split.amount,
      description: transaction.description,
      paymentType,
      isAutoMatched: true,
      matchedAt: Timestamp.now(),
      matchedBy: 'system'
    };

    // Update transaction split with ALL THREE period assignments
    await updateTransactionSplitWithAllOutflowPeriods(
      db,
      transaction.id!,
      split,
      matchingPeriods,
      outflow,
      paymentType,
      transaction.date
    );

    // Add split reference to ALL outflow periods (monthly, weekly, bi-weekly)
    const periodIdsToUpdate: string[] = [];

    if (matchingPeriods.monthlyPeriod) {
      await addSplitReferenceToOutflowPeriod(db, matchingPeriods.monthlyPeriod.id!, splitRef);
      periodIdsToUpdate.push(matchingPeriods.monthlyPeriod.id!);
    }

    if (matchingPeriods.weeklyPeriod) {
      await addSplitReferenceToOutflowPeriod(db, matchingPeriods.weeklyPeriod.id!, splitRef);
      periodIdsToUpdate.push(matchingPeriods.weeklyPeriod.id!);
    }

    if (matchingPeriods.biWeeklyPeriod) {
      await addSplitReferenceToOutflowPeriod(db, matchingPeriods.biWeeklyPeriod.id!, splitRef);
      periodIdsToUpdate.push(matchingPeriods.biWeeklyPeriod.id!);
    }

    result.splitsAssigned++;
    console.log(`[autoMatch] Assigned split ${split.id} to ${periodIdsToUpdate.length} periods as ${paymentType}`);
  }

  // Mark periods as updated (for recalculation)
  if (!result.periodsUpdated) {
    result.periodsUpdated = 0;
  }
  result.periodsUpdated += matchingPeriods.foundCount;
}

/**
 * Find ALL THREE matching outflow period types (monthly, weekly, bi-weekly)
 *
 * This ensures consistency across all period views when auto-matching transactions.
 */
function findAllMatchingOutflowPeriods(
  transactionDate: Timestamp,
  outflowPeriods: OutflowPeriod[]
): {
  monthlyPeriod: OutflowPeriod | null;
  weeklyPeriod: OutflowPeriod | null;
  biWeeklyPeriod: OutflowPeriod | null;
  foundCount: number;
} {
  const txnMs = transactionDate.toMillis();

  const result = {
    monthlyPeriod: null as OutflowPeriod | null,
    weeklyPeriod: null as OutflowPeriod | null,
    biWeeklyPeriod: null as OutflowPeriod | null,
    foundCount: 0
  };

  for (const period of outflowPeriods) {
    const startMs = period.periodStartDate.toMillis();
    const endMs = period.periodEndDate.toMillis();

    // Check if transaction date falls within this period
    if (txnMs >= startMs && txnMs <= endMs) {
      // Separate by period type (using lowercase enum values)
      if (period.periodType === 'monthly') {
        result.monthlyPeriod = period;
        result.foundCount++;
      } else if (period.periodType === 'weekly') {
        result.weeklyPeriod = period;
        result.foundCount++;
      } else if (period.periodType === 'bi_monthly') {
        result.biWeeklyPeriod = period;
        result.foundCount++;
      }
    }
  }

  return result;
}

/**
 * Determine payment type based on amount, date, and period info
 */
function determinePaymentType(
  splitAmount: number,
  transactionDate: Timestamp,
  outflowPeriod: OutflowPeriod
): PaymentType {
  const txnMs = transactionDate.toMillis();
  const now = Timestamp.now().toMillis();

  // Check if this is an extra principal payment (amount exceeds bill amount)
  if (splitAmount > outflowPeriod.billAmount * 1.1) { // 10% tolerance for rounding
    return PaymentType.EXTRA_PRINCIPAL;
  }

  // Check if this is a catch-up payment (transaction is for a past-due period)
  if (outflowPeriod.isDuePeriod && outflowPeriod.dueDate) {
    const dueMs = outflowPeriod.dueDate.toMillis();
    if (txnMs < dueMs && dueMs < now) {
      // Payment was made before due date, but due date has passed
      return PaymentType.CATCH_UP;
    }
  }

  // Check if this is an advance payment (payment made well before due date)
  if (outflowPeriod.isDuePeriod && outflowPeriod.dueDate) {
    const dueMs = outflowPeriod.dueDate.toMillis();
    const daysBeforeDue = (dueMs - txnMs) / (1000 * 60 * 60 * 24);
    if (daysBeforeDue > 7) { // More than 7 days early
      return PaymentType.ADVANCE;
    }
  }

  // Default: regular payment
  return PaymentType.REGULAR;
}

/**
 * Update transaction split with ALL THREE outflow period assignments
 *
 * This ensures the split has references to monthly, weekly, and bi-weekly periods
 * so it appears correctly in all period views.
 */
async function updateTransactionSplitWithAllOutflowPeriods(
  db: admin.firestore.Firestore,
  transactionId: string,
  split: TransactionSplit,
  matchingPeriods: {
    monthlyPeriod: OutflowPeriod | null;
    weeklyPeriod: OutflowPeriod | null;
    biWeeklyPeriod: OutflowPeriod | null;
  },
  outflow: RecurringOutflow,
  paymentType: PaymentType,
  paymentDate: Timestamp
): Promise<void> {
  const transactionRef = db.collection('transactions').doc(transactionId);

  // Update the specific split in the splits array
  const transactionDoc = await transactionRef.get();
  if (!transactionDoc.exists) {
    throw new Error(`Transaction ${transactionId} not found`);
  }

  const transactionData = transactionDoc.data() as Transaction;
  const splits = transactionData.splits || [];

  // Find and update the split
  const splitIndex = splits.findIndex(s => s.id === split.id);
  if (splitIndex === -1) {
    throw new Error(`Split ${split.id} not found in transaction ${transactionId}`);
  }

  // Primary period ID (prefer monthly, fallback to weekly, then bi-weekly)
  const primaryPeriodId = matchingPeriods.monthlyPeriod?.id ||
                         matchingPeriods.weeklyPeriod?.id ||
                         matchingPeriods.biWeeklyPeriod?.id;

  // Extract description based on structure (flat or nested)
  const outflowDescription = outflow.description || (outflow as any).metadata?.outflowDescription || '';

  splits[splitIndex] = {
    ...splits[splitIndex],
    // Outflow assignment
    outflowId: outflow.id!,
    outflowDescription: outflowDescription,
    // Primary period reference
    outflowPeriodId: primaryPeriodId,
    // ALL THREE period type references
    outflowMonthlyPeriodId: matchingPeriods.monthlyPeriod?.id || undefined,
    outflowWeeklyPeriodId: matchingPeriods.weeklyPeriod?.id || undefined,
    outflowBiWeeklyPeriodId: matchingPeriods.biWeeklyPeriod?.id || undefined,
    // Payment tracking
    paymentType,
    paymentDate, // Payment date matches transaction date
    updatedAt: Timestamp.now()
  };

  // Update the transaction
  await transactionRef.update({
    splits,
    updatedAt: Timestamp.now()
  });
}

/**
 * Add split reference to outflow period's transactionSplits array
 */
async function addSplitReferenceToOutflowPeriod(
  db: admin.firestore.Firestore,
  outflowPeriodId: string,
  splitRef: TransactionSplitReference
): Promise<void> {
  const periodRef = db.collection('outflow_periods').doc(outflowPeriodId);

  // Use arrayUnion to add the split reference
  await periodRef.update({
    transactionSplits: admin.firestore.FieldValue.arrayUnion(splitRef),
    updatedAt: Timestamp.now()
  });
}

/**
 * Recalculate status for all updated outflow periods
 */
export async function recalculateOutflowPeriodStatuses(
  db: admin.firestore.Firestore,
  periodIds: string[]
): Promise<number> {
  if (periodIds.length === 0) return 0;

  let updated = 0;

  for (const periodId of periodIds) {
    try {
      const periodRef = db.collection('outflow_periods').doc(periodId);
      const periodDoc = await periodRef.get();

      if (!periodDoc.exists) {
        console.warn(`[recalculateStatus] Period ${periodId} not found`);
        continue;
      }

      const period = { id: periodDoc.id, ...periodDoc.data() } as OutflowPeriod;

      // Calculate new status based on transaction splits
      const newStatus = calculateOutflowPeriodStatus(
        period.isDuePeriod,
        period.dueDate,
        period.expectedDueDate,
        period.amountDue,
        period.transactionSplits || []
      );

      // Update if status changed
      if (newStatus !== period.status) {
        await periodRef.update({
          status: newStatus,
          updatedAt: Timestamp.now()
        });
        updated++;
        console.log(`[recalculateStatus] Updated period ${periodId} status: ${period.status} → ${newStatus}`);
      }
    } catch (error) {
      console.error(`[recalculateStatus] Error updating period ${periodId}:`, error);
    }
  }

  return updated;
}

/**
 * Orchestrate the complete auto-matching workflow
 *
 * This function coordinates:
 * 1. Auto-matching transactions to periods
 * 2. Recalculating period statuses
 * 3. Error handling and logging
 *
 * @param db - Firestore instance
 * @param outflowId - The outflow document ID
 * @param outflow - The recurring outflow data
 * @param periodIds - Array of created period IDs
 * @returns Summary of the auto-matching operation
 */
export async function orchestrateAutoMatchingWorkflow(
  db: admin.firestore.Firestore,
  outflowId: string,
  outflow: RecurringOutflow,
  periodIds: string[]
): Promise<{
  success: boolean;
  transactionsProcessed: number;
  splitsAssigned: number;
  periodsUpdated: number;
  statusesUpdated: number;
  errors: string[];
}> {
  console.log(`[orchestrateAutoMatching] Starting auto-match for outflow ${outflowId}`);

  // Check if there are transactions to match
  if (!outflow.transactionIds || outflow.transactionIds.length === 0) {
    console.log(`[orchestrateAutoMatching] No transactions to match`);
    return {
      success: true,
      transactionsProcessed: 0,
      splitsAssigned: 0,
      periodsUpdated: 0,
      statusesUpdated: 0,
      errors: []
    };
  }

  console.log(`[orchestrateAutoMatching] Auto-matching ${outflow.transactionIds.length} historical transactions`);

  try {
    // Step 1: Auto-match transactions to periods
    const matchResult = await autoMatchTransactionToOutflowPeriods(
      db,
      outflowId,
      outflow,
      periodIds
    );

    console.log(`[orchestrateAutoMatching] Auto-match complete:`, {
      transactionsProcessed: matchResult.transactionsProcessed,
      splitsAssigned: matchResult.splitsAssigned,
      periodsUpdated: matchResult.periodsUpdated,
      errors: matchResult.errors.length
    });

    // Step 2: Recalculate statuses for updated periods
    let statusesUpdated = 0;
    if (matchResult.periodsUpdated > 0) {
      console.log(`[orchestrateAutoMatching] Recalculating statuses for ${matchResult.periodsUpdated} periods`);
      statusesUpdated = await recalculateOutflowPeriodStatuses(db, periodIds);
      console.log(`[orchestrateAutoMatching] Updated ${statusesUpdated} period statuses`);
    }

    // Step 3: Log any errors
    if (matchResult.errors.length > 0) {
      console.warn(`[orchestrateAutoMatching] Completed with ${matchResult.errors.length} errors:`, matchResult.errors);
    }

    return {
      success: true,
      transactionsProcessed: matchResult.transactionsProcessed,
      splitsAssigned: matchResult.splitsAssigned,
      periodsUpdated: matchResult.periodsUpdated,
      statusesUpdated,
      errors: matchResult.errors
    };

  } catch (error) {
    const errorMsg = `Auto-matching workflow failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    console.error(`[orchestrateAutoMatching] ${errorMsg}`);

    return {
      success: false,
      transactionsProcessed: 0,
      splitsAssigned: 0,
      periodsUpdated: 0,
      statusesUpdated: 0,
      errors: [errorMsg]
    };
  }
}
