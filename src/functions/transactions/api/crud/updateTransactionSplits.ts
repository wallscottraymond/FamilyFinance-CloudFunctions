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
import { getDocument, updateDocument } from "../../../../utils/firestore";
import * as admin from "firebase-admin";
import { assignTransactionSplits } from "../../utils/assignTransactionSplits";

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

    // Prepare update data - use Record type for flexibility with optional fields
    const updateData: Record<string, any> = {
      splits,
      updatedAt: admin.firestore.Timestamp.now(),
      updatedBy: userId,
    };

    // Add optional fields if provided
    if (userNotes !== undefined) {
      updateData.userNotes = userNotes;
    }
    if (isHidden !== undefined) {
      updateData.isHidden = isHidden;
    }
    if (isRecurring !== undefined) {
      updateData.isRecurring = isRecurring;
    }

    // Calculate split totals
    const totalAllocated = splits.reduce((sum, split) => sum + Math.abs(split.amount || 0), 0);
    updateData.isSplit = splits.length > 1;
    updateData.totalAllocated = totalAllocated;

    // Create temporary transaction for split assignment
    const tempTransaction: Transaction = {
      ...existingTransaction,
      ...updateData,
      splits: splits,
    };

    // Validate and assign splits to budgets using centralized utility
    console.log(`[updateTransactionSplits] Validating and assigning ${splits.length} splits`);
    const assignmentResult = await assignTransactionSplits(tempTransaction, userId);

    if (assignmentResult.modified) {
      console.log('[updateTransactionSplits] Splits modified during assignment:', assignmentResult.changes);
    }

    // Use the validated and assigned splits
    updateData.splits = assignmentResult.transaction.splits;

    // Ensure all splits have required fields
    const txn: any = existingTransaction;
    updateData.splits = updateData.splits.map((split: any, index: number) => {
      const now = admin.firestore.Timestamp.now();
      const splitId = split.splitId || split.id || `split_${Date.now()}_${index}`;

      // The split-edit UI sends the user's chosen category as `categoryId`
      // (the detailed Plaid enum, e.g. FOOD_AND_DRINK_GROCERIES) but does NOT
      // write the `internalDetailedCategory` field the assignment engine matches
      // on. Treat an explicit categoryId as the internalDetailedCategory
      // override so editing a split's category actually re-homes it.
      const chosenCategory =
        typeof split.categoryId === "string" &&
        split.categoryId.trim() !== "" &&
        split.categoryId.toLowerCase() !== "other"
          ? split.categoryId
          : null;

      return {
        ...split,
        // Ensure ID exists (support both splitId and id field names)
        splitId: splitId,
        id: splitId,
        // Inherit the category from the parent transaction when a (manually
        // added) split doesn't carry one — the assignment engine matches a
        // budget on the split's DETAILED category, so a category-less split
        // would otherwise fall to "Everything Else".
        plaidPrimaryCategory:
          split.plaidPrimaryCategory ?? txn.plaidPrimaryCategory ?? null,
        plaidDetailedCategory:
          split.plaidDetailedCategory ?? txn.plaidDetailedCategory ?? null,
        internalPrimaryCategory:
          split.internalPrimaryCategory ?? txn.internalPrimaryCategory ?? null,
        // Chosen category (UI categoryId) wins → re-homes on edit; else keep the
        // split's existing override, else inherit the parent transaction's.
        internalDetailedCategory:
          chosenCategory ??
          split.internalDetailedCategory ??
          txn.internalDetailedCategory ??
          null,
        // Ensure timestamps
        createdAt: split.createdAt || now,
        updatedAt: now,
        // Ensure createdBy
        createdBy: split.createdBy || userId,
      };
    });

    console.log(`[updateTransactionSplits] Splits assigned - budgetIds: ${updateData.splits.map((s: any) => s.budgetId).join(', ')}`);

    // Update transaction in Firestore (using Admin SDK - bypasses security rules)
    const updatedTransaction = await updateDocument<Transaction>(
      "transactions",
      transactionId,
      updateData as any
    );

    console.log(`[updateTransactionSplits] Transaction ${transactionId} updated successfully`);

    // Budget spend is owned by the Transaction Assignment Engine: the
    // `on_transaction_written` trigger enqueues `assign_transaction`, which
    // fans out `recompute_budget_spent` jobs. No inline increment here.

    return {
      success: true,
      transaction: updatedTransaction,
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
