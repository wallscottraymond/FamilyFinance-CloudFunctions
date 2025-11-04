/**
 * Update Transaction Cloud Function
 *
 * Updates an existing transaction.
 *
 * Memory: 256MiB, Timeout: 30s
 * CORS: Enabled
 */

import { onRequest } from "firebase-functions/v2/https";
import { Transaction, UserRole } from "../../../../types";
import { getDocument, updateDocument } from "../../../../utils/firestore";
import {
  authMiddleware,
  createErrorResponse,
  createSuccessResponse,
  checkFamilyAccess
} from "../../../../utils/auth";
import { validateRequest, updateTransactionSchema } from "../../../../utils/validation";
import { firebaseCors } from "../../../../middleware/cors";
import { updateBudgetSpending } from "../../../../utils/budgetSpending";

/**
 * Update transaction
 */
export const updateTransaction = onRequest({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
  cors: true
}, async (request, response) => {
  return firebaseCors(request, response, async () => {
    if (request.method !== "PUT") {
      return response.status(405).json(
        createErrorResponse("method-not-allowed", "Only PUT requests are allowed")
      );
    }

    try {
      const transactionId = request.query.id as string;
      if (!transactionId) {
        return response.status(400).json(
          createErrorResponse("missing-parameter", "Transaction ID is required")
        );
      }

      // Authenticate user
      const authResult = await authMiddleware(request, UserRole.VIEWER);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;

      // Get existing transaction
      const existingTransaction = await getDocument<Transaction>("transactions", transactionId);
      if (!existingTransaction) {
        return response.status(404).json(
          createErrorResponse("transaction-not-found", "Transaction not found")
        );
      }

      // Check permissions - user can edit their own transactions or admin can edit any
      if (existingTransaction.ownerId !== user.id && user.role !== UserRole.ADMIN) {
        return response.status(403).json(
          createErrorResponse("permission-denied", "Cannot edit this transaction")
        );
      }

      // Check group access (backward compatible with groupId)
      if (existingTransaction.groupId && !await checkFamilyAccess(user.id!, existingTransaction.groupId)) {
        return response.status(403).json(
          createErrorResponse("access-denied", "Cannot access this transaction")
        );
      }

      // Validate request body
      const validation = validateRequest(request.body, updateTransactionSchema);
      if (validation.error) {
        return response.status(400).json(
          createErrorResponse("validation-error", validation.error)
        );
      }

      const updateData = validation.value!;

      // Update transaction
      const updatedTransaction = await updateDocument<Transaction>(
        "transactions",
        transactionId,
        updateData
      );

      // Update budget spending based on transaction changes
      try {
        await updateBudgetSpending({
          oldTransaction: existingTransaction,
          newTransaction: updatedTransaction,
          userId: user.id!,
          groupId: existingTransaction.groupId
        });
      } catch (budgetError) {
        // Log error but don't fail transaction update
        console.error('Budget spending update failed after transaction update:', budgetError);
      }

      return response.status(200).json(createSuccessResponse(updatedTransaction));

    } catch (error: any) {
      console.error("Error updating transaction:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to update transaction")
      );
    }
  });
});
