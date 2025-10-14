/**
 * Delete Transaction Cloud Function
 *
 * Deletes a transaction and updates budget spending.
 *
 * Memory: 256MiB, Timeout: 30s
 * CORS: Enabled
 */

import { onRequest } from "firebase-functions/v2/https";
import { Transaction, UserRole } from "../../../../types";
import { getDocument, deleteDocument } from "../../../../utils/firestore";
import {
  authMiddleware,
  createErrorResponse,
  createSuccessResponse,
  checkFamilyAccess
} from "../../../../utils/auth";
import { firebaseCors } from "../../../../middleware/cors";
import { updateBudgetSpending } from "../../../../utils/budgetSpending";

/**
 * Delete transaction
 */
export const deleteTransaction = onRequest({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
  cors: true
}, async (request, response) => {
  return firebaseCors(request, response, async () => {
    if (request.method !== "DELETE") {
      return response.status(405).json(
        createErrorResponse("method-not-allowed", "Only DELETE requests are allowed")
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

      // Check permissions
      if (existingTransaction.userId !== user.id && user.role !== UserRole.ADMIN) {
        return response.status(403).json(
          createErrorResponse("permission-denied", "Cannot delete this transaction")
        );
      }

      // Check family access
      if (!await checkFamilyAccess(user.id!, existingTransaction.familyId)) {
        return response.status(403).json(
          createErrorResponse("access-denied", "Cannot access this transaction")
        );
      }

      // Update budget spending (reverse the spending) BEFORE deleting
      try {
        await updateBudgetSpending({
          oldTransaction: existingTransaction,
          newTransaction: undefined, // Indicates deletion
          userId: user.id!,
          familyId: existingTransaction.familyId
        });
      } catch (budgetError) {
        // Log error but don't fail transaction deletion
        console.error('Budget spending update failed before transaction deletion:', budgetError);
      }

      // Delete transaction
      await deleteDocument("transactions", transactionId);

      return response.status(200).json(createSuccessResponse({ deleted: true }));

    } catch (error: any) {
      console.error("Error deleting transaction:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to delete transaction")
      );
    }
  });
});
