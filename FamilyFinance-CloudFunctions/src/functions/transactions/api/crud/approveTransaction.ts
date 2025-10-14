/**
 * Approve Transaction Cloud Function
 *
 * Approves or rejects a pending transaction.
 *
 * Memory: 256MiB, Timeout: 30s
 * CORS: Enabled
 */

import { onRequest } from "firebase-functions/v2/https";
import { Transaction, UserRole, TransactionStatus } from "../../../../types";
import { getDocument, updateDocument } from "../../../../utils/firestore";
import {
  authMiddleware,
  createErrorResponse,
  createSuccessResponse,
  checkFamilyAccess
} from "../../../../utils/auth";
import * as admin from "firebase-admin";
import { firebaseCors } from "../../../../middleware/cors";

/**
 * Approve or reject transaction
 */
export const approveTransaction = onRequest({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
  cors: true
}, async (request, response) => {
  return firebaseCors(request, response, async () => {
    if (request.method !== "POST") {
      return response.status(405).json(
        createErrorResponse("method-not-allowed", "Only POST requests are allowed")
      );
    }

    try {
      const transactionId = request.query.id as string;
      const action = request.body.action; // "approve" or "reject"

      if (!transactionId || !action) {
        return response.status(400).json(
          createErrorResponse("missing-parameters", "Transaction ID and action are required")
        );
      }

      // Authenticate user
      const authResult = await authMiddleware(request, UserRole.EDITOR);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;

      // Get transaction
      const transaction = await getDocument<Transaction>("transactions", transactionId);
      if (!transaction) {
        return response.status(404).json(
          createErrorResponse("transaction-not-found", "Transaction not found")
        );
      }

      // Check family access
      if (!await checkFamilyAccess(user.id!, transaction.familyId)) {
        return response.status(403).json(
          createErrorResponse("access-denied", "Cannot access this transaction")
        );
      }

      // Check if transaction is pending
      if (transaction.status !== TransactionStatus.PENDING) {
        return response.status(400).json(
          createErrorResponse("invalid-status", "Transaction is not pending approval")
        );
      }

      // Update transaction status
      const newStatus = action === "approve" ? TransactionStatus.APPROVED : TransactionStatus.REJECTED;
      const updatedTransaction = await updateDocument<Transaction>("transactions", transactionId, {
        status: newStatus,
        approvedBy: user.id,
        approvedAt: admin.firestore.Timestamp.now(),
      });

      return response.status(200).json(createSuccessResponse(updatedTransaction));

    } catch (error: any) {
      console.error("Error approving transaction:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to update transaction status")
      );
    }
  });
});
