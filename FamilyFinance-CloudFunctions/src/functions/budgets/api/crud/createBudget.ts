import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { 
  Budget, 
  UserRole,
  BudgetPeriod
} from "../../../../types";
import { 
  createDocument, 
  getDocument
} from "../../../../utils/firestore";
import { 
  authMiddleware, 
  createErrorResponse, 
  createSuccessResponse
} from "../../../../utils/auth";
import {
  validateRequest,
  createBudgetSchema,
  validateCategoryIds
} from "../../../../utils/validation";
import { firebaseCors } from "../../../../middleware/cors";
import {
  buildAccessControl
} from "../../../../utils/documentStructure";

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
      // Authenticate user (editor or admin can create budgets)
      const authResult = await authMiddleware(request, UserRole.EDITOR);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;

      // Validate request body
      const validation = validateRequest(request.body, createBudgetSchema);
      if (validation.error) {
        return response.status(400).json(
          createErrorResponse("validation-error", validation.error)
        );
      }

      const budgetData = validation.value!;

      // Validate category IDs against categories collection
      const categoryValidation = await validateCategoryIds(budgetData.categoryIds);
      if (!categoryValidation.isValid) {
        return response.status(400).json(
          createErrorResponse(
            "invalid-categories", 
            `Invalid category IDs: ${categoryValidation.invalidIds.join(', ')}`
          )
        );
      }

      console.log(`Valid categories for budget:`, categoryValidation.validCategories);

      // Determine if this is a shared budget and validate accordingly
      const isSharedBudget = budgetData.isShared || false;
      let currency = "USD"; // Default currency
      
      if (isSharedBudget) {
        // For shared budgets, user must belong to a family
        if (!user.familyId) {
          return response.status(400).json(
            createErrorResponse("no-family", "User must belong to a family to create shared budgets")
          );
        }
        
        // Get family for currency and settings
        const family = await getDocument("families", user.familyId);
        if (!family) {
          return response.status(404).json(
            createErrorResponse("family-not-found", "Family not found")
          );
        }
        currency = (family as any).settings?.currency || "USD";
      } else {
        // For individual budgets, use user's preferred currency
        currency = user.preferences?.currency || "USD";
      }

      // Calculate dates based on period
      const startDate = new Date(budgetData.startDate);
      let endDate: Date;

      if (budgetData.endDate) {
        // Legacy support for endDate field
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

      // Handle budget end date functionality
      const isOngoing = budgetData.isOngoing !== undefined ? budgetData.isOngoing : true;
      let budgetEndDate: Date | undefined;

      if (!isOngoing && budgetData.budgetEndDate) {
        budgetEndDate = new Date(budgetData.budgetEndDate);

        // Validate that budget end date is after start date
        if (budgetEndDate <= startDate) {
          return response.status(400).json(
            createErrorResponse("invalid-end-date", "Budget end date must be after start date")
          );
        }
      }

      // Determine groupIds for access control (convert single groupId to array)
      const groupIds: string[] = [];
      const singleGroupId = budgetData.groupId || (isSharedBudget ? user.familyId : null);
      if (singleGroupId) {
        groupIds.push(singleGroupId);
      }

      // Step 1: Build complete budget structure with defaults
      const budgetDoc: Omit<Budget, "id" | "createdAt" | "updatedAt"> = {
        // === QUERY-CRITICAL FIELDS AT ROOT (defaults) ===
        userId: user.id!,
        groupIds,
        isActive: true,

        // === NESTED ACCESS CONTROL OBJECT (defaults) ===
        access: buildAccessControl(user.id!, user.id!, groupIds),

        // === NEW RBAC FIELDS ===
        createdBy: user.id!,
        ownerId: user.id!,
        isPrivate: groupIds.length === 0,

        // === LEGACY FIELDS (Backward compatibility) ===
        familyId: isSharedBudget ? user.familyId : undefined,
        groupId: singleGroupId, // Keep for backward compatibility
        accessibleBy: [user.id!], // Deprecated - kept for compatibility
        memberIds: [user.id!], // Deprecated - kept for compatibility
        isShared: isSharedBudget,

        // === BUDGET DATA ===
        name: budgetData.name,
        description: budgetData.description,
        amount: budgetData.amount,
        currency: currency,
        categoryIds: budgetData.categoryIds, // Use validated category IDs
        period: budgetData.period,
        budgetType: (budgetData.budgetType || 'recurring') as 'recurring' | 'limited',
        startDate: admin.firestore.Timestamp.fromDate(startDate),
        endDate: admin.firestore.Timestamp.fromDate(endDate), // Legacy field
        spent: 0,
        remaining: budgetData.amount,
        alertThreshold: budgetData.alertThreshold || 80,
        selectedStartPeriod: budgetData.selectedStartPeriod, // Pass through for onBudgetCreate trigger

        // Budget end date functionality
        isOngoing: isOngoing,
        budgetEndDate: budgetEndDate ? admin.firestore.Timestamp.fromDate(budgetEndDate) : undefined,
      };

      // Step 2: Budget is ready (no more enhanceWithGroupSharing needed)
      // Access control is now handled by Firestore security rules checking groupIds
      console.log(`✅ [createBudget] Budget created:`, {
        userId: user.id,
        groupIds,
        groupCount: groupIds.length,
        isPrivate: groupIds.length === 0
      });

      const finalBudget: Omit<Budget, "id" | "createdAt" | "updatedAt"> = budgetDoc;

      // Step 4: Save to Firestore (single write)
      const createdBudget = await createDocument<Budget>("budgets", finalBudget);

      return response.status(201).json(createSuccessResponse(createdBudget));

    } catch (error: any) {
      console.error("Error creating budget:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to create budget")
      );
    }
  });
});