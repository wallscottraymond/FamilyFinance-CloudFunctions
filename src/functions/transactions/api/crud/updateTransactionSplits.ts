/**
 * Update Transaction Splits - Callable Cloud Function
 *
 * Callable version of updateTransaction for mobile app usage.
 * Updates transaction splits with budget assignment and validation.
 *
 * Memory: 256MiB, Timeout: 30s
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Transaction, TransactionSplit } from "../../../../types";
import { getDocument } from "../../../../utils/firestore";
import { create_trace_context } from "../../../observability";
import { update_transaction_splits_orchestrator } from "../../../orchestrators/transactions/update_transaction_splits.orchestrator";

interface UpdateTransactionSplitsRequest {
  transactionId: string;
  splits: TransactionSplit[];
  userNotes?: string;
  isHidden?: boolean;
  isRecurring?: boolean;
}

interface UpdateTransactionSplitsResponse {
  success: boolean;
  transaction?: Transaction;
  message?: string;
}

/**
 * Update transaction splits via callable function
 *
 * This function:
 * 1. Validates user authentication and ownership
 * 2. Validates and assigns splits to budgets
 * 3. Updates the transaction in Firestore
 * 4. Updates budget spending calculations
 */
export const updateTransactionSplits = onCall<
  UpdateTransactionSplitsRequest,
  Promise<UpdateTransactionSplitsResponse>
>({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
}, async (request) => {
  // Check authentication
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const userId = request.auth.uid;
  const { transactionId, splits, userNotes, isHidden, isRecurring } = request.data;

  // Validate required fields
  if (!transactionId) {
    throw new HttpsError("invalid-argument", "Transaction ID is required");
  }

  if (!splits || !Array.isArray(splits)) {
    throw new HttpsError("invalid-argument", "Splits array is required");
  }

  try {
    console.log(`[updateTransactionSplits] User ${userId} updating transaction ${transactionId} with ${splits.length} splits`);

    // Get existing transaction
    const existingTransaction = await getDocument<Transaction>("transactions", transactionId);
    if (!existingTransaction) {
      throw new HttpsError("not-found", "Transaction not found");
    }

    // Check ownership - user can only update their own transactions
    if (existingTransaction.ownerId !== userId && existingTransaction.userId !== userId) {
      console.log(`[updateTransactionSplits] Permission denied: user ${userId} does not own transaction ${transactionId}`);
      console.log(`[updateTransactionSplits] Transaction ownerId: ${existingTransaction.ownerId}, userId: ${existingTransaction.userId}`);
      throw new HttpsError("permission-denied", "Cannot update this transaction");
    }

    // Applied immediately, in memory, written once (orchestrators/transactions/
    // update_transaction_splits — canon O2 / M3, Transaction-Integrity-Review 3g).
    const updatedTransaction = await update_transaction_splits_orchestrator(
      create_trace_context(false),
      {
        user_id: userId,
        transaction_id: transactionId,
        txn: existingTransaction as unknown as Record<string, unknown>,
        splits: splits as unknown as Array<Record<string, unknown>>,
        user_notes: userNotes,
        is_hidden: isHidden,
        is_recurring: isRecurring,
      }
    );

    return {
      success: true,
      transaction: updatedTransaction as unknown as Transaction,
      message: "Transaction updated successfully"
    };

  } catch (error: any) {
    console.error("[updateTransactionSplits] Error:", error);

    // Re-throw HttpsErrors as-is
    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError("internal", "Failed to update transaction splits");
  }
});
