/**
 * Assign Split to Outflow Period - Callable Function
 *
 * Manually assign a transaction split to an outflow period for bill payment tracking.
 * Useful for:
 * - Catch-up payments spread across multiple periods
 * - Extra payments for principal reduction
 * - Correcting auto-matching errors
 *
 * Memory: 256MiB, Timeout: 30s
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { authenticateRequest, UserRole } from '../../../utils/auth';
import { PaymentType, TransactionSplitReference, Transaction, OutflowPeriod, TransactionSplit } from '../../../types';
import * as admin from 'firebase-admin';
import { calculateOutflowPeriodStatus } from '../utils/calculateOutflowPeriodStatus';

/**
 * Request to assign a split to an outflow period
 */
export interface AssignSplitToOutflowPeriodRequest {
  transactionId: string;
  splitId: string;
  outflowPeriodId: string;
  paymentType?: 'regular' | 'catch_up' | 'advance' | 'extra_principal';
  clearBudgetAssignment?: boolean; // If moving from budget to outflow
}

/**
 * Response from assigning a split
 */
export interface AssignSplitToOutflowPeriodResponse {
  success: boolean;
  split?: TransactionSplit;
  outflowPeriod?: OutflowPeriod;
  message?: string;
}

/**
 * Callable function to assign a transaction split to an outflow period
 */
export const assignSplitToOutflowPeriod = onCall(
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
        outflowPeriodId,
        paymentType = 'regular',
        clearBudgetAssignment = false
      } = request.data as AssignSplitToOutflowPeriodRequest;

      // Validate required fields
      if (!transactionId || !splitId || !outflowPeriodId) {
        throw new HttpsError('invalid-argument', 'transactionId, splitId, and outflowPeriodId are required');
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

      console.log(`[assignSplit] User ${userId} assigning split ${splitId} to outflow period ${outflowPeriodId}`);

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

      // Step 2: Get and validate outflow period
      const periodRef = db.collection('outflow_periods').doc(outflowPeriodId);
      const periodDoc = await periodRef.get();

      if (!periodDoc.exists) {
        throw new HttpsError('not-found', `Outflow period ${outflowPeriodId} not found`);
      }

      const outflowPeriod = { id: periodDoc.id, ...periodDoc.data() } as OutflowPeriod;

      // Verify user owns the outflow period
      if (outflowPeriod.userId !== userId) {
        throw new HttpsError('permission-denied', 'You can only assign splits to your own outflow periods');
      }

      // Step 3: Find the split in the transaction
      const splits = transaction.splits || [];
      const splitIndex = splits.findIndex(s => s.id === splitId);

      if (splitIndex === -1) {
        throw new HttpsError('not-found', `Split ${splitId} not found in transaction ${transactionId}`);
      }

      const split = splits[splitIndex];

      // Step 4: Check if split is already assigned to another outflow
      if (split.outflowPeriodId && split.outflowPeriodId !== outflowPeriodId) {
        throw new HttpsError('failed-precondition', 'Split is already assigned to another outflow period. Unassign it first.');
      }

      // Step 5: If clearBudgetAssignment is true, clear budget fields
      if (clearBudgetAssignment) {
        console.log(`[assignSplit] Clearing budget assignment from split ${splitId}`);
        splits[splitIndex].budgetId = '';
        splits[splitIndex].budgetPeriodId = '';
        splits[splitIndex].budgetName = '';
      }

      // Step 6: Update the split with outflow assignment
      splits[splitIndex] = {
        ...splits[splitIndex],
        outflowPeriodId: outflowPeriodId,
        outflowId: outflowPeriod.outflowId,
        outflowDescription: outflowPeriod.outflowDescription,
        paymentType: paymentType as PaymentType,
        updatedAt: admin.firestore.Timestamp.now(),
      };

      // Step 7: Update transaction document
      await transactionRef.update({
        splits,
        updatedAt: admin.firestore.Timestamp.now()
      });

      // Step 8: Create TransactionSplitReference for outflow period
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

      // Step 9: Add split reference to outflow period
      await periodRef.update({
        transactionSplits: admin.firestore.FieldValue.arrayUnion(splitRef),
        updatedAt: admin.firestore.Timestamp.now()
      });

      // Step 10: Recalculate outflow period status
      const updatedPeriodDoc = await periodRef.get();
      const updatedPeriod = { id: updatedPeriodDoc.id, ...updatedPeriodDoc.data() } as OutflowPeriod;

      const newStatus = calculateOutflowPeriodStatus(
        updatedPeriod.isDuePeriod,
        updatedPeriod.dueDate,
        updatedPeriod.expectedDueDate,
        updatedPeriod.amountDue,
        updatedPeriod.transactionSplits || []
      );

      // Step 11: Update status if it changed
      if (newStatus !== updatedPeriod.status) {
        await periodRef.update({
          status: newStatus,
          updatedAt: admin.firestore.Timestamp.now()
        });
        updatedPeriod.status = newStatus;
        console.log(`[assignSplit] Updated outflow period status: ${outflowPeriod.status} → ${newStatus}`);
      }

      console.log(`[assignSplit] Successfully assigned split ${splitId} to outflow period ${outflowPeriodId}`);

      const response: AssignSplitToOutflowPeriodResponse = {
        success: true,
        split: splits[splitIndex],
        outflowPeriod: updatedPeriod,
        message: `Split assigned to ${outflowPeriod.outflowDescription} (${paymentType})`
      };

      return response;
    } catch (error: any) {
      console.error('[assignSplit] Error:', error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError('internal', error.message || 'Failed to assign split to outflow period');
    }
  }
);
