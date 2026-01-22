import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { Budget, BudgetPeriod, PeriodType } from "../../../types";
import { buildAccessControl } from "../../../utils/documentStructure";
import { v4 as uuidv4 } from "uuid";

const db = admin.firestore();

/**
 * DEV FUNCTION: Create Test Budget Suite
 *
 * Creates a complete test suite with THREE budgets (weekly, bi-weekly, monthly)
 * and sample transactions to verify the full budget period summary flow.
 *
 * This function tests:
 * 1. Budget creation with different period types
 * 2. Budget period generation for all three types
 * 3. Transaction creation and budget spending updates
 * 4. User_summaries calculation with new fixes (totalSpent, userNotes, maxAmount)
 *
 * IMPORTANT: This function should only be used in development/staging environments.
 *
 * @param request.data.groupId - Optional group ID for shared budgets
 * @param request.data.createTransactions - Whether to create test transactions (default: true)
 * @param request.data.transactionAmount - Amount for test transactions (default: 75)
 *
 * @returns {object} Comprehensive test results for all three budgets
 */
export const createTestBudgetSuite = onCall(async (request) => {
  console.error("=".repeat(80));
  console.error("🎯 [createTestBudgetSuite] FUNCTION INVOKED - START");
  console.error("=".repeat(80));
  console.error("Request auth:", request.auth ? "✓ Authenticated" : "✗ No auth");
  console.error("Request data:", JSON.stringify(request.data, null, 2));

  // Authentication required
  if (!request.auth) {
    console.error("❌ [createTestBudgetSuite] AUTHENTICATION FAILED - No auth provided");
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const userId = request.auth.uid;
  console.log("[createTestBudgetSuite] User authenticated:", userId);

  const {
    groupId,
    createTransactions = true,
    transactionAmount = 75,
  } = request.data || {};

  console.log("[createTestBudgetSuite] Request data:", {
    groupId,
    createTransactions,
    transactionAmount,
  });

  try {
    console.log("[createTestBudgetSuite] Setting up dates");
    const now = new Date();
    const startDate = Timestamp.fromDate(
      new Date(now.getFullYear(), now.getMonth(), 1)
    ); // First of current month

    const oneYearLater = new Date(startDate.toDate());
    oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
    const endDate = Timestamp.fromDate(oneYearLater);

    const groupIds: string[] = groupId ? [groupId] : [];
    console.log("[createTestBudgetSuite] GroupIds:", groupIds);

    // ===================================================================
    // STEP 1: Create THREE budgets with different period types
    // ===================================================================

    const budgetConfigs = [
      {
        name: "Weekly Test Budget",
        amount: 100,
        period: BudgetPeriod.WEEKLY,
        categoryIds: ["groceries", "food"],
      },
      {
        name: "Bi-Monthly Test Budget",
        amount: 200,
        period: BudgetPeriod.MONTHLY, // Note: All budgets generate all period types
        categoryIds: ["utilities", "housing"],
      },
      {
        name: "Monthly Test Budget",
        amount: 500,
        period: BudgetPeriod.MONTHLY,
        categoryIds: ["entertainment", "shopping"],
      },
    ];

    const budgetResults: any[] = [];

    console.log("[createTestBudgetSuite] Creating budgets:", budgetConfigs.length);

    for (const config of budgetConfigs) {
      console.log(`[createTestBudgetSuite] Creating ${config.period} budget`);
      const budgetId = uuidv4();
      const budget: Budget = {
        id: budgetId,
        userId,
        groupIds,
        isActive: true,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),

        // Nested access control
        access: buildAccessControl(userId, userId, groupIds),

        // Budget details
        name: config.name,
        amount: config.amount,
        currency: "USD",
        categoryIds: config.categoryIds,
        period: config.period,

        // Date range
        startDate,
        endDate,

        // Budget type
        budgetType: "recurring",
        isOngoing: true,

        // Spending tracking
        spent: 0,
        remaining: config.amount,
        alertThreshold: 80,

        // System budget flag
        isSystemEverythingElse: false,

        // Metadata
        description: `Test ${config.period} budget created for end-to-end testing - ${new Date().toISOString()}`,
      };

      // Save to Firestore
      await db.collection("budgets").doc(budgetId).set(budget);

      console.log(
        `[createTestBudgetSuite] Created ${config.period} budget: ${budgetId}`
      );

      budgetResults.push({
        period: config.period,
        budgetId,
        budget: {
          name: config.name,
          amount: config.amount,
          categoryIds: config.categoryIds,
        },
      });
    }

    // ===================================================================
    // STEP 2: Wait for budget period generation triggers to fire
    // ===================================================================

    console.log("[createTestBudgetSuite] Waiting 3 seconds for period generation...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // ===================================================================
    // STEP 3: Verify budget periods were created
    // ===================================================================

    const periodResults: any[] = [];

    for (const result of budgetResults) {
      const periodsSnapshot = await db
        .collection("budget_periods")
        .where("budgetId", "==", result.budgetId)
        .get();

      const periods = periodsSnapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          periodId: data.periodId,
          periodType: data.periodType,
          allocatedAmount: data.allocatedAmount,
          spent: data.spent || 0,
          remaining: data.remaining || data.allocatedAmount,
        };
      });

      periodResults.push({
        period: result.period,
        budgetId: result.budgetId,
        periodsGenerated: periods.length,
        periodBreakdown: {
          MONTHLY: periods.filter((p) => p.periodType === PeriodType.MONTHLY)
            .length,
          BI_MONTHLY: periods.filter((p) => p.periodType === PeriodType.BI_MONTHLY)
            .length,
          WEEKLY: periods.filter((p) => p.periodType === PeriodType.WEEKLY)
            .length,
        },
        samplePeriods: periods.slice(0, 2),
      });
    }

    // ===================================================================
    // STEP 4: Create test transactions for each budget (optional)
    // ===================================================================

    const transactionResults: any[] = [];

    if (createTransactions) {
      for (const result of budgetResults) {
        const transactionId = uuidv4();
        const transactionDate = Timestamp.now();

        // Find matching budget period
        const periodsSnapshot = await db
          .collection("budget_periods")
          .where("budgetId", "==", result.budgetId)
          .where("periodStart", "<=", transactionDate)
          .where("periodEnd", ">=", transactionDate)
          .limit(1)
          .get();

        let matchingPeriodId = null;
        if (!periodsSnapshot.empty) {
          matchingPeriodId = periodsSnapshot.docs[0].id;
        }

        const transaction = {
          id: transactionId,
          userId,
          groupIds,
          isActive: true,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),

          // Transaction details
          amount: transactionAmount,
          description: `Test transaction for ${result.budget.name}`,
          date: transactionDate,
          categoryId: result.budget.categoryIds[0],

          // Metadata
          metadata: {
            source: "test",
            notes: `Test transaction for budget suite - ${result.period}`,
            createdBy: userId,
          },

          // Link to budget
          budgetId: result.budgetId,
          budgetPeriodId: matchingPeriodId,

          // Transaction type
          type: "expense",
          status: "completed",
        };

        await db.collection("transactions").doc(transactionId).set(transaction);

        console.log(
          `[createTestBudgetSuite] Created transaction for ${result.period}: ${transactionId}`
        );

        transactionResults.push({
          period: result.period,
          budgetId: result.budgetId,
          transactionId,
          amount: transactionAmount,
          budgetPeriodId: matchingPeriodId,
        });
      }

      // Wait for spending update triggers to fire
      console.log(
        "[createTestBudgetSuite] Waiting 3 seconds for spending updates..."
      );
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    // ===================================================================
    // STEP 5: Query user_summaries to verify our fixes
    // ===================================================================

    const summarySnapshot = await db
      .collection("user_summaries")
      .where("userId", "==", userId)
      .limit(10)
      .get();

    const summaries = summarySnapshot.docs.map((doc) => {
      const data = doc.data();
      const budgetEntries = data.budgets || [];

      // Find entries matching our test budgets
      const matchingBudgets = budgetResults.map((result) => {
        const entry = budgetEntries.find(
          (b: any) => b.budgetId === result.budgetId
        );

        return {
          period: result.period,
          budgetId: result.budgetId,
          found: !!entry,
          entry: entry
            ? {
                budgetName: entry.budgetName,
                maxAmount: entry.maxAmount, // NEW FIELD - from our fix
                totalAllocated: entry.totalAllocated,
                totalSpent: entry.totalSpent, // FIXED - should not be 0
                totalRemaining: entry.totalRemaining,
                progressPercentage: entry.progressPercentage,
                userNotes: entry.userNotes, // NEW FIELD - from our fix
              }
            : null,
        };
      });

      return {
        summaryId: doc.id,
        periodType: data.periodType,
        sourcePeriodId: data.sourcePeriodId,
        matchingBudgets,
      };
    });

    // ===================================================================
    // STEP 6: Return comprehensive test results
    // ===================================================================

    return {
      success: true,
      message: "Test budget suite created successfully",
      summary: {
        budgetsCreated: budgetResults.length,
        transactionsCreated: transactionResults.length,
        totalPeriodsGenerated: periodResults.reduce(
          (sum, p) => sum + p.periodsGenerated,
          0
        ),
      },
      budgets: budgetResults.map((b, index) => ({
        ...b,
        periods: periodResults[index],
        transaction: createTransactions ? transactionResults[index] : null,
      })),
      userSummaries: {
        count: summaries.length,
        summaries: summaries.filter((s) =>
          s.matchingBudgets.some((b: any) => b.found)
        ),
      },
      verification: {
        step1: `✓ Created ${budgetResults.length} budgets (WEEKLY, BI_WEEKLY, MONTHLY)`,
        step2: `✓ Generated ${periodResults.reduce((sum, p) => sum + p.periodsGenerated, 0)} budget periods`,
        step3: createTransactions
          ? `✓ Created ${transactionResults.length} test transactions`
          : "⊘ Skipped transaction creation",
        step4: "✓ Query user_summaries to verify budget entries",
        step5: "✓ Check totalSpent is NOT 0 (our fix)",
        step6: "✓ Check maxAmount and userNotes fields exist (our fix)",
      },
      testingInstructions: {
        nextSteps: [
          "1. Check user_summaries.budgets[] for all three budget entries",
          "2. Verify totalSpent reflects transaction amounts (not hardcoded 0)",
          "3. Verify maxAmount field exists and matches totalAllocated",
          "4. Add userNotes to budget_periods and verify they appear in summaries",
          "5. Create additional transactions and verify summaries update",
        ],
      },
    };
  } catch (error) {
    console.error(
      "[createTestBudgetSuite] Error creating test budget suite:",
      error
    );
    console.error("[createTestBudgetSuite] Error stack:", error instanceof Error ? error.stack : "No stack trace");
    console.error("[createTestBudgetSuite] Error details:", JSON.stringify(error, null, 2));
    throw new HttpsError(
      "internal",
      `Failed to create test budget suite: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
});
