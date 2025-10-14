/**
 * Unassign Split from Outflow Period - Callable Function
 *
 * Remove a transaction split assignment from an outflow period.
 * Useful for:
 * - Correcting assignment errors
 * - Moving splits to different periods
 * - Removing mismatched auto-assignments
 *
 * Memory: 256MiB, Timeout: 30s
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { authenticateRequest, UserRole } from '../../../utils/auth';
import { Transaction, OutflowPeriod } from '../../../types';
import * as admin from 'firebase-admin';
import { calculateOutflowPeriodStatus } from '../utils/calculateOutflowPeriodStatus';

/**
 * Request to unassign a split from an outflow period
 */
export interface UnassignSplitFromOutflowPeriodRequest {
  transactionId: string;
  splitId: string;
  outflowPeriodId: string;
}

/**
 * Response from unassigning a split
 */
export interface UnassignSplitFromOutflowPeriodResponse {
  success: boolean;
  outflowPeriod?: OutflowPeriod;
  message?: string;
}

/**
 * Callable function to unassign a transaction split from an outflow period
 */
export const unassignSplitFromOutflowPeriod = onCall(
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
        outflowPeriodId
      } = request.data as UnassignSplitFromOutflowPeriodRequest;

      // Validate required fields
      if (!transactionId || !splitId || !outflowPeriodId) {
        throw new HttpsError('invalid-argument', 'transactionId, splitId, and outflowPeriodId are required');
      }

      console.log(`[unassignSplit] User ${userId} unassigning split ${splitId} from outflow period ${outflowPeriodId}`);

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

      // Step 2: Get and validate outflow period
      const periodRef = db.collection('outflow_periods').doc(outflowPeriodId);
      const periodDoc = await periodRef.get();

      if (!periodDoc.exists) {
        throw new HttpsError('not-found', `Outflow period ${outflowPeriodId} not found`);
      }

      const outflowPeriod = { id: periodDoc.id, ...periodDoc.data() } as OutflowPeriod;

      // Verify user owns the outflow period
      if (outflowPeriod.userId !== userId) {
        throw new HttpsError('permission-denied', 'You can only unassign splits from your own outflow periods');
      }

      // Step 3: Find the split in the transaction
      const splits = transaction.splits || [];
      const splitIndex = splits.findIndex(s => s.id === splitId);

      if (splitIndex === -1) {
        throw new HttpsError('not-found', `Split ${splitId} not found in transaction ${transactionId}`);
      }

      const split = splits[splitIndex];

      // Step 4: Verify split is assigned to this outflow period
      if (split.outflowPeriodId !== outflowPeriodId) {
        throw new HttpsError('failed-precondition', `Split ${splitId} is not assigned to outflow period ${outflowPeriodId}`);
      }

      // Step 5: Clear outflow assignment from split
      splits[splitIndex] = {
        ...splits[splitIndex],
        outflowPeriodId: undefined,
        outflowId: undefined,
        outflowDescription: undefined,
        paymentType: undefined,
        updatedAt: admin.firestore.Timestamp.now(),
      };

      // Step 6: Update transaction document
      await transactionRef.update({
        splits,
        updatedAt: admin.firestore.Timestamp.now()
      });

      // Step 7: Remove split reference from outflow period's transactionSplits array
      const transactionSplits = outflowPeriod.transactionSplits || [];
      const updatedSplits = transactionSplits.filter(
        ref => !(ref.transactionId === transactionId && ref.splitId === splitId)
      );

      await periodRef.update({
        transactionSplits: updatedSplits,
        updatedAt: admin.firestore.Timestamp.now()
      });

      // Step 8: Recalculate outflow period status
      const newStatus = calculateOutflowPeriodStatus(
        outflowPeriod.isDuePeriod,
        outflowPeriod.dueDate,
        outflowPeriod.expectedDueDate,
        outflowPeriod.amountDue,
        updatedSplits
      );

      // Step 9: Update status if it changed
      if (newStatus !== outflowPeriod.status) {
        await periodRef.update({
          status: newStatus,
          updatedAt: admin.firestore.Timestamp.now()
        });
        outflowPeriod.status = newStatus;
        console.log(`[unassignSplit] Updated outflow period status: ${outflowPeriod.status} → ${newStatus}`);
      }

      console.log(`[unassignSplit] Successfully unassigned split ${splitId} from outflow period ${outflowPeriodId}`);

      // Get updated period for response
      const updatedPeriodDoc = await periodRef.get();
      const updatedPeriod = { id: updatedPeriodDoc.id, ...updatedPeriodDoc.data() } as OutflowPeriod;

      const response: UnassignSplitFromOutflowPeriodResponse = {
        success: true,
        outflowPeriod: updatedPeriod,
        message: `Split unassigned from ${outflowPeriod.outflowDescription}`
      };

      return response;
    } catch (error: any) {
      console.error('[unassignSplit] Error:', error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError('internal', error.message || 'Failed to unassign split from outflow period');
    }
  }
);
