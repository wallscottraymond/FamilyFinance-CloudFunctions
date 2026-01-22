import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { v4 as uuidv4 } from "uuid";

const db = admin.firestore();

/**
 * DEV FUNCTION: Create Test Transaction
 *
 * Creates a test transaction linked to a budget for testing spending calculations.
 * This allows developers to verify:
 * 1. Transaction creation works
 * 2. Budget spending is updated (via updateBudgetSpending trigger)
 * 3. User_summaries.budgets[].totalSpent reflects the change
 *
 * IMPORTANT: This function should only be used in development/staging environments.
 *
 * @param request.data.budgetId - Budget ID to link transaction to
 * @param request.data.amount - Transaction amount (default: 50)
 * @param request.data.description - Transaction description (default: "Test Transaction")
 * @param request.data.date - Transaction date (default: now)
 * @param request.data.categoryId - Category ID (optional)
 *
 * @returns {object} Created transaction details and updated budget period info
 */
export const createTestTransaction = onCall(async (request) => {
  // Authentication required
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const userId = request.auth.uid;

  // Extract parameters
  const {
    budgetId,
    amount = 50,
    description = "Test Transaction",
    date,
    categoryId,
    groupId,
  } = request.data || {};

  // Validate required fields
  if (!budgetId) {
    throw new HttpsError(
      "invalid-argument",
      "budgetId is required to create a test transaction"
    );
  }

  console.log(
    `[createTestTransaction] Creating test transaction for budget: ${budgetId}`,
    {
      amount,
      description,
    }
  );

  try {
    // Verify budget exists and belongs to user
    const budgetDoc = await db.collection("budgets").doc(budgetId).get();

    if (!budgetDoc.exists) {
      throw new HttpsError("not-found", `Budget not found: ${budgetId}`);
    }

    const budgetData = budgetDoc.data();
    if (budgetData?.userId !== userId) {
      throw new HttpsError(
        "permission-denied",
        "Budget does not belong to authenticated user"
      );
    }

    // Get budget category if not provided
    const transactionCategoryId =
      categoryId || budgetData?.categoryIds?.[0] || "uncategorized";

    // Convert single groupId to groupIds array
    const groupIds: string[] = groupId ? [groupId] : budgetData?.groupIds || [];

    // Calculate transaction date
    const transactionDate = date
      ? Timestamp.fromDate(new Date(date))
      : Timestamp.now();

    // Find matching budget period
    const periodsSnapshot = await db
      .collection("budget_periods")
      .where("budgetId", "==", budgetId)
      .where("periodStart", "<=", transactionDate)
      .where("periodEnd", ">=", transactionDate)
      .limit(1)
      .get();

    let matchingPeriodId = null;
    let matchingPeriod = null;

    if (!periodsSnapshot.empty) {
      const periodDoc = periodsSnapshot.docs[0];
      matchingPeriodId = periodDoc.id;
      matchingPeriod = {
        id: matchingPeriodId,
        periodId: periodDoc.data().periodId,
        periodType: periodDoc.data().periodType,
        allocatedAmount: periodDoc.data().allocatedAmount,
        spentBefore: periodDoc.data().spent || 0,
      };
    }

    // Create transaction document
    const transactionId = uuidv4();
    const transaction = {
      id: transactionId,
      userId,
      groupIds,
      isActive: true,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),

      // Transaction details
      amount,
      description,
      date: transactionDate,
      categoryId: transactionCategoryId,

      // Metadata
      metadata: {
        source: "test",
        notes: `Test transaction created for budget: ${budgetData?.name || budgetId}`,
        createdBy: userId,
      },

      // Link to budget
      budgetId,
      budgetPeriodId: matchingPeriodId,

      // Transaction type
      type: "expense",
      status: "completed",
    };

    // Save transaction
    await db.collection("transactions").doc(transactionId).set(transaction);

    console.log(
      `[createTestTransaction] Transaction created: ${transactionId}`
    );

    // Wait for triggers to fire (updateBudgetSpending, user_summaries update)
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Query updated budget period
    let updatedPeriod = null;
    if (matchingPeriodId) {
      const periodDoc = await db
        .collection("budget_periods")
        .doc(matchingPeriodId)
        .get();

      if (periodDoc.exists) {
        const data = periodDoc.data();
        updatedPeriod = {
          id: matchingPeriodId,
          periodId: data?.periodId,
          periodType: data?.periodType,
          allocatedAmount: data?.allocatedAmount,
          spentAfter: data?.spent || 0,
          remaining: data?.remaining || 0,
          spentIncrease: (data?.spent || 0) - (matchingPeriod?.spentBefore || 0),
        };
      }
    }

    // Query user_summaries to verify update
    const summarySnapshot = await db
      .collection("user_summaries")
      .where("userId", "==", userId)
      .limit(5)
      .get();

    const summaries = summarySnapshot.docs.map((doc: admin.firestore.QueryDocumentSnapshot) => {
      const data = doc.data();
      const budgetEntries = data.budgets || [];
      const matchingBudget = budgetEntries.find(
        (b: any) => b.budgetId === budgetId
      );

      return {
        summaryId: doc.id,
        periodType: data.periodType,
        sourcePeriodId: data.sourcePeriodId,
        budgetEntry: matchingBudget
          ? {
              budgetName: matchingBudget.budgetName,
              totalAllocated: matchingBudget.totalAllocated,
              totalSpent: matchingBudget.totalSpent,
              totalRemaining: matchingBudget.totalRemaining,
              progressPercentage: matchingBudget.progressPercentage,
            }
          : null,
      };
    });

    return {
      success: true,
      message: "Test transaction created successfully",
      transaction: {
        id: transactionId,
        amount,
        description,
        date: transactionDate.toDate().toISOString(),
        budgetId,
        budgetPeriodId: matchingPeriodId,
        categoryId: transactionCategoryId,
      },
      budgetPeriod: {
        matched: !!matchingPeriodId,
        before: matchingPeriod,
        after: updatedPeriod,
      },
      userSummaries: {
        count: summaries.length,
        samples: summaries
          .filter((s: any) => s.budgetEntry !== null)
          .slice(0, 2),
      },
      verification: {
        step1: `Transaction created: ${transactionId}`,
        step2: matchingPeriodId
          ? `Budget period updated: ${matchingPeriodId}`
          : "No matching budget period found",
        step3: updatedPeriod
          ? `Spent increased by: $${updatedPeriod.spentIncrease}`
          : "Budget period not updated",
        step4: "Check user_summaries.budgets[].totalSpent for changes",
      },
    };
  } catch (error) {
    console.error(
      "[createTestTransaction] Error creating test transaction:",
      error
    );
    throw new HttpsError(
      "internal",
      `Failed to create test transaction: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
});
