/**
 * Get Transaction Cloud Function
 *
 * Retrieves a single transaction by ID.
 *
 * Memory: 256MiB, Timeout: 30s
 * CORS: Enabled
 */

import { onRequest } from "firebase-functions/v2/https";
import { Transaction, UserRole } from "../../../../types";
import { getDocument } from "../../../../utils/firestore";
import {
  authMiddleware,
  createErrorResponse,
  createSuccessResponse,
  checkFamilyAccess
} from "../../../../utils/auth";
import { firebaseCors } from "../../../../middleware/cors";

/**
 * Get transaction by ID
 */
export const getTransaction = onRequest({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
  cors: true
}, async (request, response) => {
  return firebaseCors(request, response, async () => {
    if (request.method !== "GET") {
      return response.status(405).json(
        createErrorResponse("method-not-allowed", "Only GET requests are allowed")
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

      // Get transaction
      const transaction = await getDocument<Transaction>("transactions", transactionId);
      if (!transaction) {
        return response.status(404).json(
          createErrorResponse("transaction-not-found", "Transaction not found")
        );
      }

      // Check if user can access this transaction
      if (transaction.groupId && !await checkFamilyAccess(user.id!, transaction.groupId)) {
        return response.status(403).json(
          createErrorResponse("access-denied", "Cannot access this transaction")
        );
      }

      return response.status(200).json(createSuccessResponse(transaction));

    } catch (error: any) {
      console.error("Error getting transaction:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to get transaction")
      );
    }
  });
});
