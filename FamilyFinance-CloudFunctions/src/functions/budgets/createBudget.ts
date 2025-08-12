import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { 
  Budget, 
  UserRole,
  BudgetPeriod
} from "../../types";
import { 
  createDocument, 
  getDocument
} from "../../utils/firestore";
import { 
  authMiddleware, 
  createErrorResponse, 
  createSuccessResponse
} from "../../utils/auth";
import { 
  validateRequest, 
  createBudgetSchema 
} from "../../utils/validation";
import { firebaseCors } from "../../middleware/cors";

/**
 * Create a new budget
 */
export const createBudget = onRequest({
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
      // Authenticate user (parent or admin can create budgets)
      const authResult = await authMiddleware(request, UserRole.PARENT);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;

      if (!user.familyId) {
        return response.status(400).json(
          createErrorResponse("no-family", "User must belong to a family to create budgets")
        );
      }

      // Validate request body
      const validation = validateRequest(request.body, createBudgetSchema);
      if (validation.error) {
        return response.status(400).json(
          createErrorResponse("validation-error", validation.error)
        );
      }

      const budgetData = validation.value!;

      // Get family for currency and settings
      const family = await getDocument("families", user.familyId);
      if (!family) {
        return response.status(404).json(
          createErrorResponse("family-not-found", "Family not found")
        );
      }

      // Calculate dates based on period
      const startDate = new Date(budgetData.startDate);
      let endDate: Date;

      if (budgetData.endDate) {
        endDate = new Date(budgetData.endDate);
      } else {
        // Auto-calculate end date based on period
        endDate = new Date(startDate);
        switch (budgetData.period) {
        case BudgetPeriod.WEEKLY:
          endDate.setDate(endDate.getDate() + 7);
          break;
        case BudgetPeriod.MONTHLY:
          endDate.setMonth(endDate.getMonth() + 1);
          break;
        case BudgetPeriod.QUARTERLY:
          endDate.setMonth(endDate.getMonth() + 3);
          break;
        case BudgetPeriod.YEARLY:
          endDate.setFullYear(endDate.getFullYear() + 1);
          break;
        default:
          endDate.setMonth(endDate.getMonth() + 1); // Default to monthly
        }
      }

      // Create budget
      const budget: Omit<Budget, "id" | "createdAt" | "updatedAt"> = {
        name: budgetData.name,
        description: budgetData.description,
        familyId: user.familyId,
        createdBy: user.id!,
        amount: budgetData.amount,
        currency: (family as any).settings.currency,
        category: budgetData.category,
        period: budgetData.period,
        startDate: admin.firestore.Timestamp.fromDate(startDate),
        endDate: admin.firestore.Timestamp.fromDate(endDate),
        spent: 0,
        remaining: budgetData.amount,
        alertThreshold: budgetData.alertThreshold || 80,
        isActive: true,
        memberIds: budgetData.memberIds || [user.id!],
      };

      const createdBudget = await createDocument<Budget>("budgets", budget);

      return response.status(201).json(createSuccessResponse(createdBudget));

    } catch (error: any) {
      console.error("Error creating budget:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to create budget")
      );
    }
  });
});