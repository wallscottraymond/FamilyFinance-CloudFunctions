import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { 
  UserRole
} from "../../types";
import { 
  authMiddleware, 
  createErrorResponse, 
  createSuccessResponse,
  checkUserAccess
} from "../../utils/auth";
import { firebaseCors } from "../../middleware/cors";

/**
 * Get user statistics
 */
export const getUserStatistics = onRequest({
  region: "us-central1",
  memory: "512MiB",
  timeoutSeconds: 60,
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
      const authResult = await authMiddleware(request, UserRole.VIEWER);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;
      const targetUserId = (request.query.userId as string) || user.id;

      // Check if user can access target user's statistics
      if (targetUserId !== user.id) {
        const hasAccess = await checkUserAccess(user.id!, targetUserId!);
        if (!hasAccess) {
          return response.status(403).json(
            createErrorResponse("access-denied", "Cannot access this user's statistics")
          );
        }
      }

      if (!user.familyId) {
        return response.status(400).json(
          createErrorResponse("no-family", "User must belong to a family")
        );
      }

      // Get user transactions for statistics
      const db = admin.firestore();
      const transactionsRef = db.collection("transactions");
      
      // Get current month transactions
      const currentMonthStart = new Date();
      currentMonthStart.setDate(1);
      currentMonthStart.setHours(0, 0, 0, 0);
      
      const currentMonthTransactions = await transactionsRef
        .where("userId", "==", targetUserId!)
        .where("familyId", "==", user.familyId)
        .where("status", "==", "approved")
        .where("date", ">=", admin.firestore.Timestamp.fromDate(currentMonthStart))
        .get();

      // Calculate statistics
      let totalIncome = 0;
      let totalExpenses = 0;
      let transactionCount = 0;

      currentMonthTransactions.forEach(doc => {
        const transaction = doc.data();
        if (transaction.type === "income") {
          totalIncome += transaction.amount;
        } else if (transaction.type === "expense") {
          totalExpenses += transaction.amount;
        }
        transactionCount++;
      });

      const statistics = {
        currentMonth: {
          totalIncome,
          totalExpenses,
          netAmount: totalIncome - totalExpenses,
          transactionCount,
        },
        period: {
          start: currentMonthStart.toISOString(),
          end: new Date().toISOString(),
        },
      };

      return response.status(200).json(createSuccessResponse(statistics));

    } catch (error: any) {
      console.error("Error getting user statistics:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to get user statistics")
      );
    }
  });
});