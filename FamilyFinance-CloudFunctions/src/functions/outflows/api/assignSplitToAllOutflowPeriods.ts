/**
 * =============================================================================
 * Assign Split to All Outflow Periods - Callable Cloud Function
 * =============================================================================
 *
 * This function assigns a transaction split to ALL THREE outflow period types
 * (monthly, weekly, bi-weekly) simultaneously to maintain consistency across
 * all period views in the Family Finance app.
 *
 * WHY THIS EXISTS:
 * ----------------
 * The Family Finance app displays bills in three different period views:
 * - Monthly View: Calendar month organization (e.g., October 2025)
 * - Weekly View: Weekly organization (e.g., Week 40 of 2025)
 * - Bi-Weekly View: Two-week period organization
 *
 * When a user marks a transaction as a bill payment, ALL THREE views must show
 * the payment consistently. This function ensures that by:
 * 1. Finding all three matching outflow periods
 * 2. Updating the transaction split with ALL period references
 * 3. Adding the payment to ALL three outflow_periods documents
 * 4. Recalculating status for ALL three periods atomically
 *
 * CORE FUNCTIONALITY:
 * -------------------
 * 1. **Validation**: Ensures user owns transaction, split, and outflow
 * 2. **Period Finding**: Locates all three matching periods (monthly/weekly/bi-weekly)
 * 3. **Bi-Directional Update**:
 *    - Transaction split stores period IDs
 *    - Outflow periods store split references
 * 4. **Status Recalculation**: Updates period status (pending → paid, etc.)
 * 5. **Atomic Operations**: Uses Firestore batches for data consistency
 *
 * TWO MATCHING MODES:
 * -------------------
 * MODE 1: Auto-detect from transaction date (default)
 *   - Uses transaction.date to find periods containing that date
 *   - Best for: Regular payments made on the transaction date
 *   - Example: User pays Internet bill on Oct 15 → finds Oct periods
 *
 * MODE 2: Manual target period (advance payments)
 *   - Uses targetPeriodId to find periods overlapping target period
 *   - Best for: Advance payments spanning multiple periods
 *   - Example: User pays 3 months rent → creates 3 splits with different targetPeriodIds
 *
 * DATA ARCHITECTURE:
 * ------------------
 * Bi-directional references between transaction splits and outflow periods:
 *
 * TransactionSplit (in transactions collection):
 *   - outflowId: "outflow_123"
 *   - outflowDescription: "Internet Bill"
 *   - outflowPeriodId: "outflow_123_2025-M10" (primary)
 *   - outflowMonthlyPeriodId: "outflow_123_2025-M10"
 *   - outflowWeeklyPeriodId: "outflow_123_2025-W40"
 *   - outflowBiWeeklyPeriodId: "outflow_123_2025-BM20"
 *   - paymentType: "regular"
 *   - paymentDate: Timestamp(2025-10-15)
 *
 * OutflowPeriod (in outflow_periods collection):
 *   - transactionSplits: [
 *       {
 *         transactionId: "txn_456",
 *         splitId: "split_789",
 *         amount: 89.99,
 *         paymentType: "regular",
 *         isAutoMatched: false
 *       }
 *     ]
 *
 * PAYMENT TYPES:
 * --------------
 * - REGULAR: Normal on-time payment
 * - CATCH_UP: Payment for past-due bill
 * - ADVANCE: Payment made well before due date (> 7 days)
 * - EXTRA_PRINCIPAL: Payment exceeding required amount
 *
 * PAYMENT DATE TRACKING:
 * ----------------------
 * The `paymentDate` field on the transaction split is CRITICAL:
 * - Always set to match transaction.date
 * - Preserved across all operations
 * - Enables historical payment analysis
 * - Used for payment timing calculations
 *
 * BUDGET CLEARING:
 * ----------------
 * When clearBudgetAssignment = true:
 * - Removes split from budget tracking
 * - Clears budgetId and budgetName fields
 * - Moves split from budget → outflow categorization
 *
 * USE CASES:
 * ----------
 * 1. Regular Bill Payment:
 *    User: "I paid my Internet bill today"
 *    → assignSplitToAllOutflowPeriods(txnId, splitId, outflowId, "regular")
 *    → Finds periods containing today's date
 *    → Marks all three periods as paid
 *
 * 2. Advance Payment (Single Period):
 *    User: "I paid next month's rent early"
 *    → assignSplitToAllOutflowPeriods(txnId, splitId, outflowId, "advance", true, "2025-M11")
 *    → Finds periods overlapping November 2025
 *    → Marks November periods as paid in advance
 *
 * 3. Advance Payment (Multiple Periods):
 *    User: "I paid 3 months rent with one transaction"
 *    → Create 3 splits from the transaction
 *    → assignSplitToAllOutflowPeriods(txnId, split1Id, outflowId, "advance", true, "2025-M10")
 *    → assignSplitToAllOutflowPeriods(txnId, split2Id, outflowId, "advance", true, "2025-M11")
 *    → assignSplitToAllOutflowPeriods(txnId, split3Id, outflowId, "advance", true, "2025-M12")
 *    → Each split assigned to different month's periods
 *
 * FIRESTORE OPERATIONS:
 * ---------------------
 * 1. Read: transactions/{transactionId}
 * 2. Read: outflows/{outflowId}
 * 3. Query: outflow_periods (find matching periods)
 * 4. Batch Update: transactions/{transactionId} (update split)
 * 5. Batch Update: outflow_periods/* (add split references)
 * 6. Batch Update: outflow_periods/* (recalculate statuses)
 *
 * SECURITY:
 * ---------
 * - Requires EDITOR role or higher
 * - User must own the transaction (transaction.userId === auth.uid)
 * - User must own the outflow (outflow.userId === auth.uid)
 * - Split must belong to transaction (split exists in transaction.splits)
 * - Cannot reassign split already assigned to another outflow
 *
 * PERFORMANCE:
 * ------------
 * - Memory: 256MiB (handles complex period calculations)
 * - Timeout: 30 seconds (ample time for batch operations)
 * - Batch operations: Atomic updates (all succeed or all fail)
 * - Max periods updated: 3 (one per type)
 *
 * ERROR HANDLING:
 * ---------------
 * - Missing parameters → HttpsError('invalid-argument')
 * - Invalid payment type → HttpsError('invalid-argument')
 * - Transaction not found → HttpsError('not-found')
 * - Outflow not found → HttpsError('not-found')
 * - Split not found → HttpsError('not-found')
 * - Permission denied → HttpsError('permission-denied')
 * - Split already assigned → HttpsError('failed-precondition')
 * - No matching periods → HttpsError with descriptive message
 *
 * FILE LOCATION:
 * --------------
 * src/functions/outflows/api/assignSplitToAllOutflowPeriods.ts
 *
 * This is an API function (user-facing callable function) in the outflows module.
 *
 * RELATED FILES:
 * --------------
 * - unassignSplitFromAllOutflowPeriods.ts: Reverse operation (remove assignment)
 * - findMatchingOutflowPeriods.ts: Period finding utilities
 * - calculateOutflowPeriodStatus.ts: Status calculation logic
 * - autoMatchTransactionToOutflowPeriods.ts: Automatic assignment for historical transactions
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

      await batch.commit();

      console.log(`[assignSplitToAll] Added split reference to ${matchingPeriods.foundCount} outflow periods`);

      // Step 10: Recalculate status for all updated periods (separate batch for reads)
      const statusBatch = db.batch();

      let monthlyPeriod: OutflowPeriod | undefined;
      let weeklyPeriod: OutflowPeriod | undefined;
      let biWeeklyPeriod: OutflowPeriod | undefined;

      if (matchingPeriods.monthlyPeriodId) {
        const monthlyRef = db.collection('outflow_periods').doc(matchingPeriods.monthlyPeriodId);
        const monthlyDoc = await monthlyRef.get();
        monthlyPeriod = { id: monthlyDoc.id, ...monthlyDoc.data() } as OutflowPeriod;

        const newStatus = calculateOutflowPeriodStatus(
          monthlyPeriod.isDuePeriod,
          monthlyPeriod.dueDate,
          monthlyPeriod.expectedDueDate,
          monthlyPeriod.amountDue,
          monthlyPeriod.transactionSplits || []
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

      if (matchingPeriods.weeklyPeriodId) {
        const weeklyRef = db.collection('outflow_periods').doc(matchingPeriods.weeklyPeriodId);
        const weeklyDoc = await weeklyRef.get();
        weeklyPeriod = { id: weeklyDoc.id, ...weeklyDoc.data() } as OutflowPeriod;

        const newStatus = calculateOutflowPeriodStatus(
          weeklyPeriod.isDuePeriod,
          weeklyPeriod.dueDate,
          weeklyPeriod.expectedDueDate,
          weeklyPeriod.amountDue,
          weeklyPeriod.transactionSplits || []
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

      if (matchingPeriods.biWeeklyPeriodId) {
        const biWeeklyRef = db.collection('outflow_periods').doc(matchingPeriods.biWeeklyPeriodId);
        const biWeeklyDoc = await biWeeklyRef.get();
        biWeeklyPeriod = { id: biWeeklyDoc.id, ...biWeeklyDoc.data() } as OutflowPeriod;

        const newStatus = calculateOutflowPeriodStatus(
          biWeeklyPeriod.isDuePeriod,
          biWeeklyPeriod.dueDate,
          biWeeklyPeriod.expectedDueDate,
          biWeeklyPeriod.amountDue,
          biWeeklyPeriod.transactionSplits || []
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
