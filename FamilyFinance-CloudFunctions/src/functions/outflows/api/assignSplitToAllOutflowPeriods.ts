/**
 * Assign Split to All Outflow Periods - Callable Cloud Function
 *
 * Assigns a transaction split to ALL THREE outflow period types (monthly, weekly, bi-weekly)
 * simultaneously to maintain consistency across all period views in the app.
 *
 * CRITICAL: This is the ONLY supported method for assigning splits to outflows.
 * Always assigns to all three period types to keep views synchronized.
 *
 * PARAMETERS:
 * - transactionId: Transaction containing the split
 * - splitId: Specific split to assign
 * - outflowId: Parent outflow ID (not period ID!)
 * - paymentType: 'regular' | 'catch_up' | 'advance' | 'extra_principal'
 * - clearBudgetAssignment: Clear budget fields when moving to outflow
 * - targetPeriodId: Optional specific period for advance payments
 *
 * MATCHING MODES:
 * 1. Auto-detect (default): Uses transaction date to find matching periods
 * 2. Manual target: Uses targetPeriodId for advance payments across multiple periods
 *
 * RETURNS:
 * - success: boolean
 * - split: Updated transaction split with all period references
 * - monthlyPeriod, weeklyPeriod, biWeeklyPeriod: Updated period documents
 * - periodsUpdated: Count of periods updated (up to 3)
 *
 * PAYMENT TYPES:
 * - REGULAR: Normal on-time payment
 * - CATCH_UP: Payment for past-due bill
 * - ADVANCE: Payment > 7 days before due date
 * - EXTRA_PRINCIPAL: Payment exceeding required amount
 *
 * SECURITY:
 * - Requires EDITOR role or higher
 * - User must own transaction and outflow
 * - Cannot reassign split already assigned to another outflow
 *
 * See CLAUDE.md for detailed workflow examples and data architecture.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { authenticateRequest, UserRole } from '../../../utils/auth';
import { PaymentType, TransactionSplitReference, Transaction, OutflowPeriod, TransactionSplit, RecurringOutflow } from '../../../types';
import * as admin from 'firebase-admin';
import { calculateOutflowPeriodStatus } from '../utils/calculateOutflowPeriodStatus';
import { findMatchingOutflowPeriods, findMatchingOutflowPeriodsBySourcePeriod, validatePeriodsFound } from '../utils/findMatchingOutflowPeriods';

/**
 * Request to assign a split to all outflow periods
 */
export interface AssignSplitToAllOutflowPeriodsRequest {
  transactionId: string;
  splitId: string;
  outflowId: string;  // Parent outflow ID (not period ID!)
  paymentType?: 'regular' | 'catch_up' | 'advance' | 'extra_principal';
  clearBudgetAssignment?: boolean;  // Clear budget fields when moving to outflow
  targetPeriodId?: string;  // Optional: Specific period ID to assign to (for advance payments across multiple periods)
}

/**
 * Response from assigning a split to all periods
 */
export interface AssignSplitToAllOutflowPeriodsResponse {
  success: boolean;
  split?: TransactionSplit;
  monthlyPeriod?: OutflowPeriod;
  weeklyPeriod?: OutflowPeriod;
  biWeeklyPeriod?: OutflowPeriod;
  periodsUpdated: number;
  message?: string;
}

/**
 * Callable function to assign a transaction split to ALL outflow periods
 */
export const assignSplitToAllOutflowPeriods = onCall(
  {
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      // Authenticate user (EDITOR role required)
      const authResult = await authenticateRequest(request, UserRole.EDITOR);
      const userId = authResult.user.uid;

      const {
        transactionId,
        splitId,
        outflowId,
        paymentType = 'regular',
        clearBudgetAssignment = false,
        targetPeriodId
      } = request.data as AssignSplitToAllOutflowPeriodsRequest;

      // Validate required fields
      if (!transactionId || !splitId || !outflowId) {
        throw new HttpsError('invalid-argument', 'transactionId, splitId, and outflowId are required');
      }

      // Validate payment type
      const validPaymentTypes: PaymentType[] = [
        PaymentType.REGULAR,
        PaymentType.CATCH_UP,
        PaymentType.ADVANCE,
        PaymentType.EXTRA_PRINCIPAL
      ];
      if (!validPaymentTypes.includes(paymentType as PaymentType)) {
        throw new HttpsError('invalid-argument', `Invalid payment type: ${paymentType}`);
      }

      console.log(`[assignSplitToAll] User ${userId} assigning split ${splitId} to outflow ${outflowId}`);

      const db = admin.firestore();

      // Step 1: Get and validate transaction
      const transactionRef = db.collection('transactions').doc(transactionId);
      const transactionDoc = await transactionRef.get();

      if (!transactionDoc.exists) {
        throw new HttpsError('not-found', `Transaction ${transactionId} not found`);
      }

      const transaction = { id: transactionDoc.id, ...transactionDoc.data() } as Transaction;

      // Verify user owns the transaction
      if (transaction.userId !== userId) {
        throw new HttpsError('permission-denied', 'You can only assign your own transaction splits');
      }

      // Step 2: Get and validate outflow
      const outflowRef = db.collection('outflows').doc(outflowId);
      const outflowDoc = await outflowRef.get();

      if (!outflowDoc.exists) {
        throw new HttpsError('not-found', `Outflow ${outflowId} not found`);
      }

      const outflow = { id: outflowDoc.id, ...outflowDoc.data() } as RecurringOutflow;

      // Verify user owns the outflow
      if (outflow.userId !== userId) {
        throw new HttpsError('permission-denied', 'You can only assign splits to your own outflows');
      }

      // Step 3: Find the split in the transaction
      const splits = transaction.splits || [];
      const splitIndex = splits.findIndex(s => s.id === splitId);

      if (splitIndex === -1) {
        throw new HttpsError('not-found', `Split ${splitId} not found in transaction ${transactionId}`);
      }

      const split = splits[splitIndex];

      // Step 4: Check if split is already assigned to an outflow
      if (split.outflowId && split.outflowId !== outflowId) {
        throw new HttpsError('failed-precondition', 'Split is already assigned to another outflow. Unassign it first.');
      }

      // Step 5: Find all matching outflow periods
      // If targetPeriodId is provided, use it to find overlapping periods (for advance payments)
      // Otherwise, use transaction date to find current periods
      let matchingPeriods;
      if (targetPeriodId) {
        console.log(`[assignSplitToAll] Using target period: ${targetPeriodId}`);
        matchingPeriods = await findMatchingOutflowPeriodsBySourcePeriod(db, outflowId, targetPeriodId);
      } else {
        console.log(`[assignSplitToAll] Using transaction date: ${transaction.date.toDate().toISOString()}`);
        matchingPeriods = await findMatchingOutflowPeriods(db, outflowId, transaction.date);
      }
      validatePeriodsFound(matchingPeriods);

      console.log(`[assignSplitToAll] Found ${matchingPeriods.foundCount} matching periods`);

      // Step 6: Update the split with ALL outflow period references
      const updatedSplit: TransactionSplit = {
        ...splits[splitIndex],
        // Clear budget assignment if requested
        budgetId: clearBudgetAssignment ? '' : splits[splitIndex].budgetId,
        budgetName: clearBudgetAssignment ? '' : splits[splitIndex].budgetName,
        // Set outflow assignment
        outflowId: outflowId,
        outflowDescription: outflow.description,
        // Primary period reference (monthly if available, otherwise first found)
        outflowPeriodId: matchingPeriods.monthlyPeriodId ||
                        matchingPeriods.weeklyPeriodId ||
                        matchingPeriods.biWeeklyPeriodId ||
                        undefined,
        // All three period type references
        outflowMonthlyPeriodId: matchingPeriods.monthlyPeriodId || undefined,
        outflowWeeklyPeriodId: matchingPeriods.weeklyPeriodId || undefined,
        outflowBiWeeklyPeriodId: matchingPeriods.biWeeklyPeriodId || undefined,
        // Payment classification
        paymentType: paymentType as PaymentType,
        // Payment date (matches transaction date)
        paymentDate: transaction.date,
        // Timestamp
        updatedAt: admin.firestore.Timestamp.now(),
      };

      // Step 7: Update transaction document
      splits[splitIndex] = updatedSplit;
      await transactionRef.update({
        splits,
        updatedAt: admin.firestore.Timestamp.now()
      });

      console.log(`[assignSplitToAll] Updated transaction split with all period references`);

      // Step 8: Create TransactionSplitReference for outflow periods
      const splitRef: TransactionSplitReference = {
        transactionId: transaction.id!,
        splitId: split.id,
        transactionDate: transaction.date,
        amount: split.amount,
        description: transaction.description,
        paymentType: paymentType as PaymentType,
        isAutoMatched: false,
        matchedAt: admin.firestore.Timestamp.now(),
        matchedBy: userId
      };

      // Step 9: Batch update ALL outflow periods with the transaction reference
      const batch = db.batch();

      if (matchingPeriods.monthlyPeriodId) {
        const monthlyRef = db.collection('outflow_periods').doc(matchingPeriods.monthlyPeriodId);
        batch.update(monthlyRef, {
          transactionSplits: admin.firestore.FieldValue.arrayUnion(splitRef),
          updatedAt: admin.firestore.Timestamp.now()
        });
      }

      if (matchingPeriods.weeklyPeriodId) {
        const weeklyRef = db.collection('outflow_periods').doc(matchingPeriods.weeklyPeriodId);
        batch.update(weeklyRef, {
          transactionSplits: admin.firestore.FieldValue.arrayUnion(splitRef),
          updatedAt: admin.firestore.Timestamp.now()
        });
      }

      if (matchingPeriods.biWeeklyPeriodId) {
        const biWeeklyRef = db.collection('outflow_periods').doc(matchingPeriods.biWeeklyPeriodId);
        batch.update(biWeeklyRef, {
          transactionSplits: admin.firestore.FieldValue.arrayUnion(splitRef),
          updatedAt: admin.firestore.Timestamp.now()
        });
      }

      // Step 10: Fetch period documents for status recalculation BEFORE batch commit
      // This allows us to cache the period data and avoid re-reading after the batch update
      const cachedPeriods: {
        monthly?: OutflowPeriod;
        weekly?: OutflowPeriod;
        biWeekly?: OutflowPeriod;
      } = {};

      // Fetch all periods in parallel before committing the batch
      const periodFetchPromises: Promise<void>[] = [];

      if (matchingPeriods.monthlyPeriodId) {
        periodFetchPromises.push(
          db.collection('outflow_periods').doc(matchingPeriods.monthlyPeriodId).get()
            .then(doc => {
              if (doc.exists) {
                cachedPeriods.monthly = { id: doc.id, ...doc.data() } as OutflowPeriod;
              }
            })
        );
      }

      if (matchingPeriods.weeklyPeriodId) {
        periodFetchPromises.push(
          db.collection('outflow_periods').doc(matchingPeriods.weeklyPeriodId).get()
            .then(doc => {
              if (doc.exists) {
                cachedPeriods.weekly = { id: doc.id, ...doc.data() } as OutflowPeriod;
              }
            })
        );
      }

      if (matchingPeriods.biWeeklyPeriodId) {
        periodFetchPromises.push(
          db.collection('outflow_periods').doc(matchingPeriods.biWeeklyPeriodId).get()
            .then(doc => {
              if (doc.exists) {
                cachedPeriods.biWeekly = { id: doc.id, ...doc.data() } as OutflowPeriod;
              }
            })
        );
      }

      // Wait for all period fetches to complete
      await Promise.all(periodFetchPromises);

      // Now commit the batch with split references
      await batch.commit();

      console.log(`[assignSplitToAll] Added split reference to ${matchingPeriods.foundCount} outflow periods`);

      // Step 11: Recalculate status using cached period data (no additional reads needed!)
      const statusBatch = db.batch();

      let monthlyPeriod: OutflowPeriod | undefined;
      let weeklyPeriod: OutflowPeriod | undefined;
      let biWeeklyPeriod: OutflowPeriod | undefined;

      if (matchingPeriods.monthlyPeriodId && cachedPeriods.monthly) {
        const monthlyRef = db.collection('outflow_periods').doc(matchingPeriods.monthlyPeriodId);
        monthlyPeriod = cachedPeriods.monthly;

        // Update transactionSplits in memory to include the new split
        const updatedSplits = [...(monthlyPeriod.transactionSplits || []), splitRef];

        const newStatus = calculateOutflowPeriodStatus(
          monthlyPeriod.isDuePeriod,
          monthlyPeriod.dueDate,
          monthlyPeriod.expectedDueDate,
          monthlyPeriod.amountDue,
          updatedSplits // Use updated splits for status calculation
        );

        if (newStatus !== monthlyPeriod.status) {
          statusBatch.update(monthlyRef, {
            status: newStatus,
            updatedAt: admin.firestore.Timestamp.now()
          });
          monthlyPeriod.status = newStatus;
          console.log(`[assignSplitToAll] Monthly period status: ${newStatus}`);
        }
      }

      if (matchingPeriods.weeklyPeriodId && cachedPeriods.weekly) {
        const weeklyRef = db.collection('outflow_periods').doc(matchingPeriods.weeklyPeriodId);
        weeklyPeriod = cachedPeriods.weekly;

        // Update transactionSplits in memory to include the new split
        const updatedSplits = [...(weeklyPeriod.transactionSplits || []), splitRef];

        const newStatus = calculateOutflowPeriodStatus(
          weeklyPeriod.isDuePeriod,
          weeklyPeriod.dueDate,
          weeklyPeriod.expectedDueDate,
          weeklyPeriod.amountDue,
          updatedSplits // Use updated splits for status calculation
        );

        if (newStatus !== weeklyPeriod.status) {
          statusBatch.update(weeklyRef, {
            status: newStatus,
            updatedAt: admin.firestore.Timestamp.now()
          });
          weeklyPeriod.status = newStatus;
          console.log(`[assignSplitToAll] Weekly period status: ${newStatus}`);
        }
      }

      if (matchingPeriods.biWeeklyPeriodId && cachedPeriods.biWeekly) {
        const biWeeklyRef = db.collection('outflow_periods').doc(matchingPeriods.biWeeklyPeriodId);
        biWeeklyPeriod = cachedPeriods.biWeekly;

        // Update transactionSplits in memory to include the new split
        const updatedSplits = [...(biWeeklyPeriod.transactionSplits || []), splitRef];

        const newStatus = calculateOutflowPeriodStatus(
          biWeeklyPeriod.isDuePeriod,
          biWeeklyPeriod.dueDate,
          biWeeklyPeriod.expectedDueDate,
          biWeeklyPeriod.amountDue,
          updatedSplits // Use updated splits for status calculation
        );

        if (newStatus !== biWeeklyPeriod.status) {
          statusBatch.update(biWeeklyRef, {
            status: newStatus,
            updatedAt: admin.firestore.Timestamp.now()
          });
          biWeeklyPeriod.status = newStatus;
          console.log(`[assignSplitToAll] Bi-weekly period status: ${newStatus}`);
        }
      }

      await statusBatch.commit();

      console.log(`[assignSplitToAll] Successfully assigned split to ${matchingPeriods.foundCount} periods`);

      const response: AssignSplitToAllOutflowPeriodsResponse = {
        success: true,
        split: updatedSplit,
        monthlyPeriod,
        weeklyPeriod,
        biWeeklyPeriod,
        periodsUpdated: matchingPeriods.foundCount,
        message: `Split assigned to ${outflow.description} (${paymentType}) - ${matchingPeriods.foundCount} periods updated`
      };

      return response;
    } catch (error: any) {
      console.error('[assignSplitToAll] Error:', error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError('internal', error.message || 'Failed to assign split to outflow periods');
    }
  }
);
