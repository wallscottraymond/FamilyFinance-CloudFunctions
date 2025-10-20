/**
 * Unassign Split from All Outflow Periods - Callable Function
 *
 * Removes a transaction split assignment from ALL THREE outflow period types
 * (monthly, weekly, bi-weekly) simultaneously. This ensures that when a user
 * removes a bill payment assignment, all period views are updated correctly.
 *
 * Key Features:
 * - Extracts all three period IDs from the transaction split
 * - Clears all outflow references from the split
 * - Removes payment reference from all three outflow_periods documents
 * - Recalculates status for all three periods
 * - Atomic batch operations for data consistency
 *
 * Memory: 256MiB, Timeout: 30s
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { authenticateRequest, UserRole } from '../../../utils/auth';
import { Transaction, OutflowPeriod } from '../../../types';
import * as admin from 'firebase-admin';
import { calculateOutflowPeriodStatus } from '../utils/calculateOutflowPeriodStatus';

/**
 * Request to unassign a split from all outflow periods
 */
export interface UnassignSplitFromAllOutflowPeriodsRequest {
  transactionId: string;
  splitId: string;
}

/**
 * Response from unassigning a split from all periods
 */
export interface UnassignSplitFromAllOutflowPeriodsResponse {
  success: boolean;
  monthlyPeriod?: OutflowPeriod;
  weeklyPeriod?: OutflowPeriod;
  biWeeklyPeriod?: OutflowPeriod;
  periodsUpdated: number;
  message?: string;
}

/**
 * Callable function to unassign a transaction split from ALL outflow periods
 */
export const unassignSplitFromAllOutflowPeriods = onCall(
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
        splitId
      } = request.data as UnassignSplitFromAllOutflowPeriodsRequest;

      // Validate required fields
      if (!transactionId || !splitId) {
        throw new HttpsError('invalid-argument', 'transactionId and splitId are required');
      }

      console.log(`[unassignSplitFromAll] User ${userId} unassigning split ${splitId} from all outflow periods`);

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
        throw new HttpsError('permission-denied', 'You can only unassign your own transaction splits');
      }

      // Step 2: Find the split in the transaction
      const splits = transaction.splits || [];
      const splitIndex = splits.findIndex(s => s.id === splitId);

      if (splitIndex === -1) {
        throw new HttpsError('not-found', `Split ${splitId} not found in transaction ${transactionId}`);
      }

      const split = splits[splitIndex];

      // Step 3: Extract all period IDs from the split
      const periodIds: string[] = [];
      if (split.outflowMonthlyPeriodId) periodIds.push(split.outflowMonthlyPeriodId);
      if (split.outflowWeeklyPeriodId) periodIds.push(split.outflowWeeklyPeriodId);
      if (split.outflowBiWeeklyPeriodId) periodIds.push(split.outflowBiWeeklyPeriodId);

      if (periodIds.length === 0) {
        throw new HttpsError('failed-precondition', 'Split is not assigned to any outflow periods');
      }

      console.log(`[unassignSplitFromAll] Found ${periodIds.length} period assignments to remove`);

      // Step 4: Clear all outflow fields from the split
      splits[splitIndex] = {
        ...splits[splitIndex],
        outflowPeriodId: undefined,
        outflowId: undefined,
        outflowDescription: undefined,
        outflowMonthlyPeriodId: undefined,
        outflowWeeklyPeriodId: undefined,
        outflowBiWeeklyPeriodId: undefined,
        paymentType: undefined,
        updatedAt: admin.firestore.Timestamp.now(),
      };

      // Step 5: Update transaction document
      await transactionRef.update({
        splits,
        updatedAt: admin.firestore.Timestamp.now()
      });

      console.log(`[unassignSplitFromAll] Cleared outflow assignment from split`);

      // Step 6: Batch remove split reference from ALL outflow periods
      const removeBatch = db.batch();

      for (const periodId of periodIds) {
        const periodRef = db.collection('outflow_periods').doc(periodId);
        const periodDoc = await periodRef.get();

        if (periodDoc.exists) {
          const period = periodDoc.data();
          const transactionSplits = period?.transactionSplits || [];

          // Filter out this split reference
          const updatedSplits = transactionSplits.filter(
            (ref: any) => !(ref.transactionId === transactionId && ref.splitId === splitId)
          );

          removeBatch.update(periodRef, {
            transactionSplits: updatedSplits,
            updatedAt: admin.firestore.Timestamp.now()
          });
        }
      }

      await removeBatch.commit();

      console.log(`[unassignSplitFromAll] Removed split reference from ${periodIds.length} periods`);

      // Step 7: Recalculate status for all updated periods
      const statusBatch = db.batch();

      let monthlyPeriod: OutflowPeriod | undefined;
      let weeklyPeriod: OutflowPeriod | undefined;
      let biWeeklyPeriod: OutflowPeriod | undefined;

      for (const periodId of periodIds) {
        const periodRef = db.collection('outflow_periods').doc(periodId);
        const periodDoc = await periodRef.get();

        if (periodDoc.exists) {
          const period = { id: periodDoc.id, ...periodDoc.data() } as OutflowPeriod;

          const newStatus = calculateOutflowPeriodStatus(
            period.isDuePeriod,
            period.dueDate,
            period.expectedDueDate,
            period.amountDue,
            period.transactionSplits || []
          );

          if (newStatus !== period.status) {
            statusBatch.update(periodRef, {
              status: newStatus,
              updatedAt: admin.firestore.Timestamp.now()
            });
            period.status = newStatus;
            console.log(`[unassignSplitFromAll] Period ${periodId} status: ${newStatus}`);
          }

          // Store period for response based on type
          if (period.periodType === 'monthly') {
            monthlyPeriod = period;
          } else if (period.periodType === 'weekly') {
            weeklyPeriod = period;
          } else if (period.periodType === 'bi_monthly') {
            biWeeklyPeriod = period;
          }
        }
      }

      await statusBatch.commit();

      console.log(`[unassignSplitFromAll] Successfully unassigned split from ${periodIds.length} periods`);

      const response: UnassignSplitFromAllOutflowPeriodsResponse = {
        success: true,
        monthlyPeriod,
        weeklyPeriod,
        biWeeklyPeriod,
        periodsUpdated: periodIds.length,
        message: `Split unassigned from ${periodIds.length} periods`
      };

      return response;
    } catch (error: any) {
      console.error('[unassignSplitFromAll] Error:', error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError('internal', error.message || 'Failed to unassign split from outflow periods');
    }
  }
);
