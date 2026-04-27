import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  Budget,
  UserRole
} from "../../../../types";
import {
  getDocument
} from "../../../../utils/firestore";
import {
  authMiddleware,
  createErrorResponse,
  createSuccessResponse,
  checkFamilyAccess
} from "../../../../utils/auth";
import { firebaseCors } from "../../../../middleware/cors";

const db = admin.firestore();

/**
 * Delete budget (hard delete)
 *
 * Permanently deletes:
 * - The budget document
 * - All budget_periods for this budget
 * - Removes budget from user_summary
 * - Reassigns transaction splits to "Everything Else" budget
 */
export const deleteBudget = onRequest({
  region: "us-central1",
  memory: "512MiB",
  timeoutSeconds: 120,
  cors: true
}, async (request, response) => {
  return firebaseCors(request, response, async () => {
    if (request.method !== "DELETE") {
      return response.status(405).json(
        createErrorResponse("method-not-allowed", "Only DELETE requests are allowed")
      );
    }

    try {
      const budgetId = request.query.id as string;
      if (!budgetId) {
        return response.status(400).json(
          createErrorResponse("missing-parameter", "Budget ID is required")
        );
      }

      // Authenticate user (minimum VIEWER role - ownership checked next)
      const authResult = await authMiddleware(request, UserRole.VIEWER);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;

      // Get existing budget to check ownership
      const existingBudget = await getDocument<Budget>("budgets", budgetId);
      if (!existingBudget) {
        return response.status(404).json(
          createErrorResponse("budget-not-found", "Budget not found")
        );
      }

      // Check permissions: OWNER always allowed, OR EDITOR/ADMIN role
      const isOwner = existingBudget.createdBy === user.id;
      const isEditor = user.role === UserRole.EDITOR || user.role === UserRole.ADMIN;

      if (!isOwner && !isEditor) {
        return response.status(403).json(
          createErrorResponse("permission-denied", "Cannot delete this budget - you must be the owner or have editor role")
        );
      }

      // Check access - for individual budgets check ownership, for shared budgets check family access
      if (existingBudget.isShared && existingBudget.familyId) {
        // Shared budget - check family access
        if (!await checkFamilyAccess(user.id!, existingBudget.familyId)) {
          return response.status(403).json(
            createErrorResponse("access-denied", "Cannot access this family budget")
          );
        }
      } else {
        // Individual budget - check ownership
        if (existingBudget.createdBy !== user.id!) {
          return response.status(403).json(
            createErrorResponse("access-denied", "Cannot delete budget created by another user")
          );
        }
      }

      // CRITICAL: Prevent deletion of "everything else" budget
      if (existingBudget.isSystemEverythingElse) {
        return response.status(400).json(
          createErrorResponse(
            "cannot-delete-system-budget",
            'The "Everything Else" budget is a system budget and cannot be deleted'
          )
        );
      }

      console.log(`[deleteBudget] Starting hard delete for budget: ${budgetId} (${existingBudget.name})`);

      // Step 1: Find the Everything Else budget for reassigning transactions
      const everythingElseQuery = await db.collection("budgets")
        .where("userId", "==", user.id)
        .where("isSystemEverythingElse", "==", true)
        .limit(1)
        .get();

      const everythingElseBudgetId = everythingElseQuery.empty ? null : everythingElseQuery.docs[0].id;
      console.log(`[deleteBudget] Everything Else budget: ${everythingElseBudgetId || 'not found'}`);

      // Step 2: Reassign transaction splits from this budget to Everything Else
      console.log(`[deleteBudget] Reassigning transaction splits...`);
      const transactionsQuery = await db.collection("transactions")
        .where("userId", "==", user.id)
        .get();

      let transactionsUpdated = 0;
      let splitsReassigned = 0;

      if (!transactionsQuery.empty) {
        let batch = db.batch();
        let batchCount = 0;

        for (const txnDoc of transactionsQuery.docs) {
          const txnData = txnDoc.data();
          const splits = txnData.splits || [];
          let modified = false;

          const newSplits = splits.map((split: any) => {
            if (split.budgetId === budgetId) {
              splitsReassigned++;
              modified = true;
              return {
                ...split,
                budgetId: everythingElseBudgetId || 'unassigned'
              };
            }
            return split;
          });

          if (modified) {
            transactionsUpdated++;
            batch.update(txnDoc.ref, {
              splits: newSplits,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            batchCount++;

            if (batchCount >= 500) {
              await batch.commit();
              console.log(`[deleteBudget] Committed batch of ${batchCount} transaction updates`);
              batch = db.batch();
              batchCount = 0;
            }
          }
        }

        if (batchCount > 0) {
          await batch.commit();
          console.log(`[deleteBudget] Committed final batch of ${batchCount} transaction updates`);
        }
      }

      console.log(`[deleteBudget] Reassigned ${splitsReassigned} splits across ${transactionsUpdated} transactions`);

      // Step 3: Delete all budget_periods for this budget
      console.log(`[deleteBudget] Deleting budget_periods...`);
      const budgetPeriodsSnapshot = await db
        .collection("budget_periods")
        .where("budgetId", "==", budgetId)
        .get();

      let periodsDeleted = 0;

      if (!budgetPeriodsSnapshot.empty) {
        let batch = db.batch();
        let batchCount = 0;

        for (const doc of budgetPeriodsSnapshot.docs) {
          batch.delete(doc.ref);
          periodsDeleted++;
          batchCount++;

          if (batchCount >= 500) {
            await batch.commit();
            console.log(`[deleteBudget] Deleted batch of ${batchCount} budget_periods`);
            batch = db.batch();
            batchCount = 0;
          }
        }

        if (batchCount > 0) {
          await batch.commit();
          console.log(`[deleteBudget] Deleted final batch of ${batchCount} budget_periods`);
        }
      }

      console.log(`[deleteBudget] Deleted ${periodsDeleted} budget_periods`);

      // Step 4: Delete the budget document
      console.log(`[deleteBudget] Deleting budget document...`);
      await db.collection("budgets").doc(budgetId).delete();

      // Step 5: User summary will auto-update via triggers when budget_periods are deleted
      // The onBudgetPeriodDeleted trigger handles this automatically

      console.log(`[deleteBudget] Successfully deleted budget: ${budgetId}`);
      return response.status(200).json(createSuccessResponse({
        deleted: true,
        budgetId,
        budgetName: existingBudget.name,
        budgetPeriodsDeleted: periodsDeleted,
        transactionsUpdated,
        splitsReassigned
      }));

    } catch (error: any) {
      console.error("Error deleting budget:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to delete budget")
      );
    }
  });
});
