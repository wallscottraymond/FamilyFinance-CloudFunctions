import { onRequest } from "firebase-functions/v2/https";
import { 
  Transaction, 
  UserRole,
  TransactionStatus
} from "../../types";
import { 
  createDocument, 
  getDocument, 
  updateDocument, 
  deleteDocument, 
  queryDocuments 
} from "../../utils/firestore";
import { 
  authMiddleware, 
  createErrorResponse, 
  createSuccessResponse,
  checkFamilyAccess 
} from "../../utils/auth";
import { 
  validateRequest, 
  createTransactionSchema, 
  updateTransactionSchema,
  validateTransactionPermission
} from "../../utils/validation";
import * as admin from "firebase-admin";
import { firebaseCors } from "../../middleware/cors";

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

      // Create transaction
      const transaction: Omit<Transaction, "id" | "createdAt" | "updatedAt"> = {
        userId: user.id!,
        familyId: user.familyId,
        amount: transactionData.amount,
        currency: (family as any).settings.currency,
        description: transactionData.description,
        category: transactionData.category,
        type: transactionData.type,
        date: transactionData.date 
          ? admin.firestore.Timestamp.fromDate(new Date(transactionData.date))
          : admin.firestore.Timestamp.now(),
        location: transactionData.location,
        tags: transactionData.tags || [],
        budgetId: transactionData.budgetId,
        status: permissionCheck.requiresApproval ? TransactionStatus.PENDING : TransactionStatus.APPROVED,
        metadata: {
          createdBy: user.id,
          requiresApproval: permissionCheck.requiresApproval,
        },
      };

      const createdTransaction = await createDocument<Transaction>("transactions", transaction);

      return response.status(201).json(createSuccessResponse(createdTransaction));

    } catch (error: any) {
      console.error("Error creating transaction:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to create transaction")
      );
    }
  });
});

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
      if (!await checkFamilyAccess(user.id!, transaction.familyId)) {
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
      if (existingTransaction.userId !== user.id && user.role !== UserRole.ADMIN) {
        return response.status(403).json(
          createErrorResponse("permission-denied", "Cannot edit this transaction")
        );
      }

      // Check family access
      if (!await checkFamilyAccess(user.id!, existingTransaction.familyId)) {
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

      return response.status(200).json(createSuccessResponse(updatedTransaction));

    } catch (error: any) {
      console.error("Error updating transaction:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to update transaction")
      );
    }
  });
});

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

/**
 * Get user transactions
 */
export const getUserTransactions = onRequest({
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
      const authResult = await authMiddleware(request, UserRole.VIEWER);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;
      const targetUserId = (request.query.userId as string) || user.id;
      const limit = parseInt(request.query.limit as string) || 50;
      const offset = parseInt(request.query.offset as string) || 0;

      // Check if user can access target user's transactions
      if (targetUserId !== user.id && user.role === UserRole.VIEWER) {
        return response.status(403).json(
          createErrorResponse("permission-denied", "Cannot access other user's transactions")
        );
      }

      if (!user.familyId) {
        return response.status(400).json(
          createErrorResponse("no-family", "User must belong to a family")
        );
      }

      // Query transactions
      const transactions = await queryDocuments<Transaction>("transactions", {
        where: [
          { field: "userId", operator: "==", value: targetUserId },
          { field: "familyId", operator: "==", value: user.familyId },
        ],
        orderBy: "createdAt",
        orderDirection: "desc",
        limit,
        offset,
      });

      return response.status(200).json(createSuccessResponse(transactions));

    } catch (error: any) {
      console.error("Error getting user transactions:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to get transactions")
      );
    }
  });
});

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

// Export trigger functions
export { onOutflowCreated } from "./onOutflowCreated";
export { onInflowCreated } from "./onInflowCreated";