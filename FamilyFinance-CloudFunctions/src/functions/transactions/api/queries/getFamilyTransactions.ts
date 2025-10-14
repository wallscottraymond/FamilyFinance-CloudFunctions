/**
 * Get Family Transactions Cloud Function
 *
 * Retrieves all transactions for a family.
 *
 * Memory: 256MiB, Timeout: 30s
 * CORS: Enabled
 */

import { onRequest } from "firebase-functions/v2/https";
import { Transaction, UserRole } from "../../../../types";
import { queryDocuments } from "../../../../utils/firestore";
import {
  authMiddleware,
  createErrorResponse,
  createSuccessResponse
} from "../../../../utils/auth";
import { firebaseCors } from "../../../../middleware/cors";

/**
 * Get family transactions
 */
export const getFamilyTransactions = onRequest({
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
      // Authenticate user
      const authResult = await authMiddleware(request, UserRole.EDITOR);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;
      
      if (!user.familyId) {
        return response.status(400).json(
          createErrorResponse("no-family", "User must belong to a family")
        );
      }

      const limit = parseInt(request.query.limit as string) || 100;
      const offset = parseInt(request.query.offset as string) || 0;

      // Query all family transactions
      const transactions = await queryDocuments<Transaction>("transactions", {
        where: [
          { field: "familyId", operator: "==", value: user.familyId },
        ],
        orderBy: "createdAt",
        orderDirection: "desc",
        limit,
        offset,
      });

      return response.status(200).json(createSuccessResponse(transactions));

    } catch (error: any) {
      console.error("Error getting family transactions:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to get family transactions")
      );
    }
  });
});
