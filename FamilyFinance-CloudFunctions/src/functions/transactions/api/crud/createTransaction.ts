/**
 * Create Transaction Cloud Function
 *
 * Creates a new transaction with automatic budget period assignment and splitting support.
 *
 * Memory: 256MiB, Timeout: 30s
 * CORS: Enabled
 */

import { onRequest } from "firebase-functions/v2/https";
import {
  Transaction,
  UserRole,
  TransactionStatus
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
  createTransactionSchema,
  validateTransactionPermission
} from "../../../../utils/validation";
import * as admin from "firebase-admin";
import { firebaseCors } from "../../../../middleware/cors";
import { updateBudgetSpending } from "../../../../utils/budgetSpending";
import {
  buildAccessControl,
  buildTransactionCategories,
  buildMetadata,
  buildRelationships
} from "../../../../utils/documentStructure";
import { matchTransactionSplitsToSourcePeriods } from "../../utils/matchTransactionSplitsToSourcePeriods";

/**
 * Create a new transaction
 */
export const createTransaction = onRequest({
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
      // Authenticate user
      const authResult = await authMiddleware(request, UserRole.VIEWER);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;

      // Validate request body
      const validation = validateRequest(request.body, createTransactionSchema);
      if (validation.error) {
        return response.status(400).json(
          createErrorResponse("validation-error", validation.error)
        );
      }

      const transactionData = validation.value!;

      // Check if user belongs to a family
      if (!user.familyId) {
        return response.status(400).json(
          createErrorResponse("no-family", "User must belong to a family to create transactions")
        );
      }

      // Get family document to check settings
      const family = await getDocument("families", user.familyId);
      if (!family) {
        return response.status(404).json(
          createErrorResponse("family-not-found", "Family not found")
        );
      }

      // Check transaction permissions
      const permissionCheck = validateTransactionPermission(
        user.role,
        transactionData.amount,
        (family as any).settings
      );

      if (!permissionCheck.canCreate) {
        return response.status(403).json(
          createErrorResponse("permission-denied", permissionCheck.reason || "Cannot create transaction")
        );
      }

      // Determine group membership (convert legacy familyId to groupIds array)
      const groupIds: string[] = [];
      if (transactionData.groupId) {
        groupIds.push(transactionData.groupId);
      } else if (user.familyId) {
        groupIds.push(user.familyId);
      }

      // Transaction date for payment tracking and period matching
      const transactionDate = transactionData.date
        ? admin.firestore.Timestamp.fromDate(new Date(transactionData.date))
        : admin.firestore.Timestamp.now();

      // Create default split for the transaction (period IDs will be populated below)
      const defaultSplit = {
        id: admin.firestore().collection('_dummy').doc().id,
        budgetId: transactionData.budgetId || 'unassigned',
        budgetName: 'General',
        categoryId: transactionData.category,
        category: null,
        categoryPrimary: null,
        amount: transactionData.amount,
        description: null,
        isDefault: true,

        // Source period IDs (will be populated by matchTransactionSplitsToSourcePeriods)
        monthlyPeriodId: null,
        weeklyPeriodId: null,
        biWeeklyPeriodId: null,

        // Assignment references (populated when assigned)
        outflowId: null,

        // Enhanced status fields
        isIgnored: false,
        isRefund: false,
        isTaxDeductible: false,
        ignoredReason: null,
        refundReason: null,
        taxDeductibleCategory: null,
        note: null,

        // Payment tracking
        paymentDate: transactionDate,

        createdAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
        createdBy: user.id!,
      };

      // Create transaction using hybrid structure
      const transaction: Omit<Transaction, "id" | "createdAt" | "updatedAt"> = {
        // === QUERY-CRITICAL FIELDS AT ROOT (for composite indexes) ===
        userId: user.id!,
        groupIds,
        accountId: undefined, // Not available in CreateTransactionRequest
        amount: transactionData.amount,
        date: transactionDate,
        status: permissionCheck.requiresApproval ? TransactionStatus.PENDING : TransactionStatus.APPROVED,
        isActive: true,

        // === NESTED ACCESS CONTROL OBJECT ===
        access: buildAccessControl(user.id!, user.id!, groupIds),

        // === NESTED CATEGORIES OBJECT ===
        categories: buildTransactionCategories(transactionData.category, {
          tags: transactionData.tags || [],
          budgetCategory: transactionData.budgetId
        }),

        // === NESTED METADATA OBJECT ===
        metadata: buildMetadata(user.id!, 'manual', {
          requiresApproval: permissionCheck.requiresApproval
        }),

        // === NESTED RELATIONSHIPS OBJECT ===
        relationships: {
          ...buildRelationships({
            budgetId: transactionData.budgetId
          }),
          affectedBudgets: transactionData.budgetId ? [transactionData.budgetId] : [],
          affectedBudgetPeriods: [], // Will be populated when budget period is assigned
          primaryBudgetId: transactionData.budgetId,
          primaryBudgetPeriodId: undefined // Will be assigned when budget period is determined
        },

        // === TRANSACTION-SPECIFIC FIELDS AT ROOT ===
        currency: (family as any).settings.currency,
        description: transactionData.description,
        type: transactionData.type,
        splits: [defaultSplit],
        isSplit: false,
        totalAllocated: transactionData.amount,
        unallocated: 0,
      };

      // Match transaction splits to source periods (app-wide)
      const transactionsWithPeriods = await matchTransactionSplitsToSourcePeriods([transaction as Transaction]);
      const transactionWithPeriods = transactionsWithPeriods[0];

      const createdTransaction = await createDocument<Transaction>("transactions", transactionWithPeriods);

      // Update budget spending based on transaction splits
      try {
        await updateBudgetSpending({
          newTransaction: createdTransaction,
          userId: user.id!,
          familyId: user.familyId
        });
      } catch (budgetError) {
        // Log error but don't fail transaction creation
        console.error('Budget spending update failed after transaction creation:', budgetError);
      }

      return response.status(201).json(createSuccessResponse(createdTransaction));

    } catch (error: any) {
      console.error("Error creating transaction:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to create transaction")
      );
    }
  });
});
