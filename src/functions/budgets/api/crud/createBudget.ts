import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import {
  Budget,
  User,
  UserRole,
  BudgetPeriod
} from "../../../../types";
import {
  createDocument,
  getDocument
} from "../../../../utils/firestore";
import {
  validateRequest,
  createBudgetSchema,
  validateCategoryIds
} from "../../../../utils/validation";
import {
  buildAccessControl
} from "../../../../utils/documentStructure";
import { claimCategories } from "../../utils/categoryTransfer";

/**
 * Create a new budget
 *
 * Callable function (use with Firebase Functions SDK httpsCallable)
 */
export const createBudget = onCall({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30
}, async (request) => {
  console.log('🚀 [createBudget] Function called with data:', JSON.stringify(request.data, null, 2));
  console.log('🔐 [createBudget] Auth:', request.auth ? `userId: ${request.auth.uid}` : 'NO AUTH');

  try {
    // Check authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    // Get user document to check role
    console.log('👤 [createBudget] Fetching user document for:', request.auth.uid);
    const userDoc = await getDocument<User>('users', request.auth.uid);
    if (!userDoc) {
      throw new HttpsError('not-found', 'User profile not found');
    }

    const user: User = { ...userDoc, id: request.auth.uid } as User;
    console.log('✅ [createBudget] User found:', user.id, 'role:', user.role);

    // Check user role
    if (user.role !== UserRole.EDITOR && user.role !== UserRole.ADMIN) {
      console.error('❌ [createBudget] Permission denied - user role:', user.role);
      throw new HttpsError('permission-denied', `Required role: editor, user role: ${user.role}`);
    }

    console.log('✅ [createBudget] Role check passed');

    // Validate request data
    console.log('🔍 [createBudget] Validating request data...');
    const validation = validateRequest(request.data, createBudgetSchema);
    if (validation.error) {
      throw new HttpsError('invalid-argument', validation.error);
    }

    const budgetData = validation.value!;

    // Validate category IDs against categories collection
    const categoryValidation = await validateCategoryIds(budgetData.categoryIds);
    if (!categoryValidation.isValid) {
      throw new HttpsError(
        'invalid-argument',
        `Invalid category IDs: ${categoryValidation.invalidIds.join(', ')}`
      );
    }

    console.log(`Valid categories for budget:`, categoryValidation.validCategories);

      // Determine if this is a shared budget and validate accordingly
    const isSharedBudget = budgetData.isShared || false;
    let currency = "USD"; // Default currency

    if (isSharedBudget) {
      // For shared budgets, user must belong to a family
      if (!user.familyId) {
        throw new HttpsError('failed-precondition', 'User must belong to a family to create shared budgets');
      }

      // Get family for currency and settings
      const family = await getDocument("families", user.familyId);
      if (!family) {
        throw new HttpsError('not-found', 'Family not found');
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
        throw new HttpsError('invalid-argument', 'Budget end date must be after start date');
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
        startDate: Timestamp.fromDate(startDate),
        endDate: Timestamp.fromDate(endDate), // Legacy field
        spent: 0,
        remaining: budgetData.amount,
        alertThreshold: budgetData.alertThreshold || 80,
        selectedStartPeriod: budgetData.selectedStartPeriod, // Pass through for onBudgetCreate trigger

        // Budget end date functionality
        isOngoing: isOngoing,
        budgetEndDate: budgetEndDate ? Timestamp.fromDate(budgetEndDate) : undefined,
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

    console.log('✅ Budget created successfully:', createdBudget.id);

    // Step 5: Transfer categories from their current owners (e.g., "Everything Else")
    // This removes the categories from other budgets that currently own them
    if (budgetData.categoryIds && budgetData.categoryIds.length > 0) {
      console.log(`🔄 [createBudget] Transferring ${budgetData.categoryIds.length} categories to new budget`);
      const transferResult = await claimCategories(
        user.id!,
        budgetData.categoryIds,
        createdBudget.id!
      );

      if (transferResult.success) {
        console.log(`✅ [createBudget] Category transfer complete:`, {
          transferred: transferResult.transferred.length,
          alreadyOwned: transferResult.alreadyOwned.length,
        });
      } else {
        // Log but don't fail - the budget was created successfully
        console.warn(`⚠️ [createBudget] Category transfer had issues:`, transferResult.errors);
      }
    }

    return createdBudget;

  } catch (error: any) {
    console.error("Error creating budget:", error);

    // Re-throw HttpsErrors as-is
    if (error.code && error.message) {
      throw error;
    }

    // Wrap unknown errors
    throw new HttpsError('internal', 'Failed to create budget');
  }
});