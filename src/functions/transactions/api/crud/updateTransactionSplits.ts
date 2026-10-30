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
import {
  update_transaction_splits_orchestrator,
  StaleSplitEditError,
} from "../../../orchestrators/transactions/update_transaction_splits.orchestrator";

interface UpdateTransactionSplitsRequest {
  transactionId: string;
  splits: TransactionSplit[];
  userNotes?: string;
  /** Ignored — Hide was removed (an old app build may still send it). */
  isHidden?: boolean;
  isRecurring?: boolean;
  /** `updatedAt` (ms) of the copy the app edited; see StaleSplitEditError (P4-H1). */
  baseUpdatedAtMs?: number;
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
  const { transactionId, splits, userNotes, isRecurring, baseUpdatedAtMs } = request.data;

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

    // The parts can never add up to MORE than the transaction (else the extra is counted in
    // budgets as money that was never spent). Any app version passes through here.
    const txn_total = Math.abs(Number((existingTransaction as unknown as { amount?: number }).amount) || 0);
    const parts_total = (splits as Array<{ amount?: number }>).reduce(
      (t, s) => t + Math.abs(Number(s.amount) || 0),
      0
    );
    if (txn_total > 0 && parts_total > txn_total + 0.01) {
      throw new HttpsError(
        "invalid-argument",
        `The splits add up to ${parts_total.toFixed(2)}, more than the transaction's ${txn_total.toFixed(2)}`
      );
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
        is_recurring: isRecurring,
        base_updated_at_ms: typeof baseUpdatedAtMs === "number" ? baseUpdatedAtMs : undefined,
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
    if (error instanceof StaleSplitEditError) {
      // The app re-reads the transaction and re-applies the edit.
      throw new HttpsError("aborted", "This transaction just changed. Reload and try again.");
    }

    throw new HttpsError("internal", "Failed to update transaction splits");
  }
});
