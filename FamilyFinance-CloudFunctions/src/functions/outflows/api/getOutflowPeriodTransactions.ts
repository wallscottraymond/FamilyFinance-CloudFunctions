/**
 * Get Outflow Period Transactions - Callable Function
 *
 * Retrieve all transactions and splits assigned to an outflow period.
 * Returns enriched data with full transaction details for display in the detail screen.
 *
 * Memory: 256MiB, Timeout: 30s
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { authenticateRequest, UserRole } from '../../../utils/auth';
import { Transaction, OutflowPeriod, TransactionSplitReference, PaymentType } from '../../../types';
import * as admin from 'firebase-admin';

/**
 * Request to get transactions for an outflow period
 */
export interface GetOutflowPeriodTransactionsRequest {
  outflowPeriodId: string;
}

/**
 * Enriched transaction data with split details
 */
export interface OutflowPeriodTransaction {
  transaction: {
    id: string;
    amount: number;
    description: string;
    date: admin.firestore.Timestamp;
    merchantName?: string;
    category: string;
    pending: boolean;
    accountId?: string;
  };
  split: {
    id: string;
    amount: number;
    description?: string;
    categoryId: string;
  };
  splitReference: TransactionSplitReference;
}

/**
 * Response from getting outflow period transactions
 */
export interface GetOutflowPeriodTransactionsResponse {
  success: boolean;
  outflowPeriod: {
    id: string;
    outflowDescription: string;
    amountDue: number;
    status: string;
    isDuePeriod: boolean;
    dueDate?: admin.firestore.Timestamp;
  };
  transactions: OutflowPeriodTransaction[];
  summary: {
    totalPaid: number;
    totalRegular: number;
    totalCatchUp: number;
    totalAdvance: number;
    totalExtraPrincipal: number;
    transactionCount: number;
    splitCount: number;
  };
  message?: string;
}

/**
 * Callable function to get transactions assigned to an outflow period
 */
export const getOutflowPeriodTransactions = onCall(
  {
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      // Authenticate user (VIEWER role required - read only)
      const authResult = await authenticateRequest(request, UserRole.VIEWER);
      const userId = authResult.user.uid;

      const { outflowPeriodId } = request.data as GetOutflowPeriodTransactionsRequest;

      // Validate required fields
      if (!outflowPeriodId) {
        throw new HttpsError('invalid-argument', 'outflowPeriodId is required');
      }

      console.log(`[getOutflowPeriodTransactions] User ${userId} requesting transactions for period ${outflowPeriodId}`);

      const db = admin.firestore();

      // Step 1: Get and validate outflow period
      const periodRef = db.collection('outflow_periods').doc(outflowPeriodId);
      const periodDoc = await periodRef.get();

      if (!periodDoc.exists) {
        throw new HttpsError('not-found', `Outflow period ${outflowPeriodId} not found`);
      }

      const outflowPeriod = { id: periodDoc.id, ...periodDoc.data() } as OutflowPeriod;

      // Verify user owns the outflow period (or is in the same family)
      if (outflowPeriod.userId !== userId) {
        // TODO: Check family membership when family feature is implemented
        throw new HttpsError('permission-denied', 'You can only view your own outflow periods');
      }

      // Step 2: Get transaction split references
      const transactionSplits = outflowPeriod.transactionSplits || [];

      if (transactionSplits.length === 0) {
        console.log(`[getOutflowPeriodTransactions] No transactions assigned to period ${outflowPeriodId}`);
        return {
          success: true,
          outflowPeriod: {
            id: outflowPeriod.id!,
            outflowDescription: outflowPeriod.metadata.outflowDescription,
            amountDue: outflowPeriod.amountDue,
            status: outflowPeriod.status,
            isDuePeriod: outflowPeriod.isDuePeriod,
            dueDate: outflowPeriod.dueDate
          },
          transactions: [],
          summary: {
            totalPaid: 0,
            totalRegular: 0,
            totalCatchUp: 0,
            totalAdvance: 0,
            totalExtraPrincipal: 0,
            transactionCount: 0,
            splitCount: 0
          },
          message: 'No transactions assigned to this period'
        };
      }

      // Step 3: Fetch full transaction documents
      const enrichedTransactions: OutflowPeriodTransaction[] = [];
      const transactionIds = [...new Set(transactionSplits.map(ref => ref.transactionId))];

      for (const transactionId of transactionIds) {
        try {
          const transactionDoc = await db.collection('transactions').doc(transactionId).get();

          if (!transactionDoc.exists) {
            console.warn(`[getOutflowPeriodTransactions] Transaction ${transactionId} not found, skipping`);
            continue;
          }

          const transaction = { id: transactionDoc.id, ...transactionDoc.data() } as Transaction;

          // Get all splits from this transaction that are assigned to this period
          const matchingSplitRefs = transactionSplits.filter(ref => ref.transactionId === transactionId);

          for (const splitRef of matchingSplitRefs) {
            // Find the actual split in the transaction
            const split = transaction.splits.find(s => s.id === splitRef.splitId);

            if (!split) {
              console.warn(`[getOutflowPeriodTransactions] Split ${splitRef.splitId} not found in transaction ${transactionId}, skipping`);
              continue;
            }

            // Create enriched transaction object
            enrichedTransactions.push({
              transaction: {
                id: transaction.id!,
                amount: transaction.amount,
                description: transaction.description,
                date: transaction.date,
                merchantName: transaction.metadata?.plaidMerchantName as string | undefined,
                category: transaction.categories?.primary,
                pending: false, // Assuming transactions are no longer pending if they're synced
                accountId: transaction.accountId
              },
              split: {
                id: split.id,
                amount: split.amount,
                description: split.description ?? undefined,
                categoryId: split.categoryId
              },
              splitReference: splitRef
            });
          }
        } catch (error) {
          console.error(`[getOutflowPeriodTransactions] Error fetching transaction ${transactionId}:`, error);
        }
      }

      // Step 4: Calculate summary statistics
      const summary = {
        totalPaid: 0,
        totalRegular: 0,
        totalCatchUp: 0,
        totalAdvance: 0,
        totalExtraPrincipal: 0,
        transactionCount: transactionIds.length,
        splitCount: enrichedTransactions.length
      };

      enrichedTransactions.forEach(({ splitReference }) => {
        summary.totalPaid += splitReference.amount;

        switch (splitReference.paymentType) {
          case PaymentType.REGULAR:
            summary.totalRegular += splitReference.amount;
            break;
          case PaymentType.CATCH_UP:
            summary.totalCatchUp += splitReference.amount;
            break;
          case PaymentType.ADVANCE:
            summary.totalAdvance += splitReference.amount;
            break;
          case PaymentType.EXTRA_PRINCIPAL:
            summary.totalExtraPrincipal += splitReference.amount;
            break;
        }
      });

      // Step 5: Sort transactions by date (most recent first)
      enrichedTransactions.sort((a, b) =>
        b.transaction.date.toMillis() - a.transaction.date.toMillis()
      );

      console.log(`[getOutflowPeriodTransactions] Returning ${enrichedTransactions.length} transactions for period ${outflowPeriodId}`);

      const response: GetOutflowPeriodTransactionsResponse = {
        success: true,
        outflowPeriod: {
          id: outflowPeriod.id!,
          outflowDescription: outflowPeriod.metadata.outflowDescription,
          amountDue: outflowPeriod.amountDue,
          status: outflowPeriod.status,
          isDuePeriod: outflowPeriod.isDuePeriod,
          dueDate: outflowPeriod.dueDate
        },
        transactions: enrichedTransactions,
        summary,
        message: `Found ${enrichedTransactions.length} transaction(s)`
      };

      return response;
    } catch (error: any) {
      console.error('[getOutflowPeriodTransactions] Error:', error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError('internal', error.message || 'Failed to get outflow period transactions');
    }
  }
);
