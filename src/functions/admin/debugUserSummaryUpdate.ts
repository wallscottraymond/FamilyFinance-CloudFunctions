import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

const db = getFirestore();

/**
 * DEBUG FUNCTION: Trace why user_summaries aren't being updated
 *
 * This function manually traces through the exact same flow that the
 * onBudgetPeriodCreatedPeriodSummary trigger should follow, logging
 * every step to identify where it's breaking.
 *
 * Usage:
 * firebase functions:call debugUserSummaryUpdate --data '{
 *   "budgetPeriodId": "1f911cf1-9a88-41ed-968f-13d600198b6f_2026BM06B"
 * }'
 */
export const debugUserSummaryUpdate = onCall(async (request) => {
  const { budgetPeriodId } = request.data;

  if (!budgetPeriodId) {
    throw new HttpsError("invalid-argument", "budgetPeriodId is required");
  }

  console.log("=".repeat(80));
  console.log("🔍 DEBUG: User Summary Update Flow");
  console.log("=".repeat(80));

  const results: any = {
    step1_fetchBudgetPeriod: {},
    step2_extractFields: {},
    step3_buildSummaryId: {},
    step4_checkSummaryExists: {},
    step5_fetchBudgetPeriods: {},
    step6_calculateEntries: {},
    step7_finalSummary: {},
    errors: []
  };

  try {
    // ============================================================
    // STEP 1: Fetch the budget_period document
    // ============================================================
    console.log("\n📋 STEP 1: Fetching budget_period document...");
    console.log(`   Document ID: ${budgetPeriodId}`);

    const budgetPeriodRef = db.collection("budget_periods").doc(budgetPeriodId);
    const budgetPeriodSnap = await budgetPeriodRef.get();

    if (!budgetPeriodSnap.exists) {
      throw new Error(`Budget period ${budgetPeriodId} not found`);
    }

    const budgetPeriod = budgetPeriodSnap.data();
    results.step1_fetchBudgetPeriod = {
      success: true,
      documentId: budgetPeriodSnap.id,
      data: budgetPeriod
    };

    console.log("   ✓ Found budget_period:");
    console.log(`     - budgetId: ${budgetPeriod?.budgetId}`);
    console.log(`     - userId: ${budgetPeriod?.userId}`);
    console.log(`     - sourcePeriodId: ${budgetPeriod?.sourcePeriodId}`);
    console.log(`     - periodType: ${budgetPeriod?.periodType}`);
    console.log(`     - isActive: ${budgetPeriod?.isActive}`);
    console.log(`     - allocatedAmount: ${budgetPeriod?.allocatedAmount}`);
    console.log(`     - budgetName: ${budgetPeriod?.budgetName}`);

    // ============================================================
    // STEP 2: Extract fields needed for summary update
    // ============================================================
    console.log("\n📊 STEP 2: Extracting fields for summary update...");

    const userId = budgetPeriod?.userId;
    const sourcePeriodId = budgetPeriod?.sourcePeriodId;
    const periodType = budgetPeriod?.periodType;

    if (!userId) {
      throw new Error("Budget period missing userId field");
    }
    if (!sourcePeriodId) {
      throw new Error("Budget period missing sourcePeriodId field");
    }
    if (!periodType) {
      throw new Error("Budget period missing periodType field");
    }

    results.step2_extractFields = {
      success: true,
      userId,
      sourcePeriodId,
      periodType
    };

    console.log("   ✓ Extracted fields:");
    console.log(`     - userId: "${userId}"`);
    console.log(`     - sourcePeriodId: "${sourcePeriodId}"`);
    console.log(`     - periodType: "${periodType}"`);

    // ============================================================
    // STEP 3: Build expected summary document ID
    // ============================================================
    console.log("\n🆔 STEP 3: Building summary document ID...");

    const expectedSummaryId = `${userId}_${periodType}_${sourcePeriodId}`;

    results.step3_buildSummaryId = {
      success: true,
      summaryId: expectedSummaryId
    };

    console.log(`   ✓ Expected summary ID: "${expectedSummaryId}"`);

    // ============================================================
    // STEP 4: Check if summary document exists
    // ============================================================
    console.log("\n📄 STEP 4: Checking if summary document exists...");

    const summaryRef = db.collection("user_summaries").doc(expectedSummaryId);
    const summarySnap = await summaryRef.get();

    results.step4_checkSummaryExists = {
      exists: summarySnap.exists,
      documentId: expectedSummaryId
    };

    if (summarySnap.exists) {
      const currentData = summarySnap.data();
      console.log("   ✓ Summary document EXISTS");
      console.log(`     - budgets array length: ${currentData?.budgets?.length || 0}`);
      console.log(`     - outflows array length: ${currentData?.outflows?.length || 0}`);
      console.log(`     - lastRecalculated: ${currentData?.lastRecalculated}`);
      results.step4_checkSummaryExists.currentData = {
        budgetsCount: currentData?.budgets?.length || 0,
        outflowsCount: currentData?.outflows?.length || 0,
        inflowsCount: currentData?.inflows?.length || 0,
        goalsCount: currentData?.goals?.length || 0
      };
    } else {
      console.log("   ✗ Summary document DOES NOT EXIST");
      console.log("   This might be the problem - document should have been pre-created");
    }

    // ============================================================
    // STEP 5: Query budget_periods (same as fetchBudgetsBatch)
    // ============================================================
    console.log("\n🔎 STEP 5: Querying budget_periods (fetchBudgetsBatch logic)...");
    console.log("   Query conditions:");
    console.log(`     - userId == "${userId}"`);
    console.log(`     - sourcePeriodId == "${sourcePeriodId}"`);
    console.log(`     - isActive == true`);

    const budgetPeriodsQuery = db
      .collection("budget_periods")
      .where("userId", "==", userId)
      .where("sourcePeriodId", "==", sourcePeriodId)
      .where("isActive", "==", true);

    const budgetPeriodsSnap = await budgetPeriodsQuery.get();

    results.step5_fetchBudgetPeriods = {
      success: true,
      queryConditions: { userId, sourcePeriodId, isActive: true },
      documentsFound: budgetPeriodsSnap.size,
      documentIds: budgetPeriodsSnap.docs.map(doc => doc.id)
    };

    console.log(`   ✓ Query returned ${budgetPeriodsSnap.size} budget_periods`);

    if (budgetPeriodsSnap.empty) {
      console.log("   ⚠️  WARNING: No budget_periods found!");
      console.log("   This is why budgets[] array is empty in user_summaries");
      console.log("\n   Possible causes:");
      console.log("   1. userId mismatch (budget_period has different userId)");
      console.log("   2. sourcePeriodId mismatch (different format/value)");
      console.log("   3. isActive is false");
      results.errors.push("fetchBudgetsBatch returned 0 documents");
    } else {
      console.log("   Budget periods found:");
      budgetPeriodsSnap.forEach(doc => {
        const data = doc.data();
        console.log(`     - ${doc.id}`);
        console.log(`       budgetName: ${data.budgetName}`);
        console.log(`       allocatedAmount: ${data.allocatedAmount}`);
        console.log(`       spent: ${data.spent || 0}`);
      });
    }

    // ============================================================
    // STEP 6: Convert to budget entries (calculateBudgetSummary)
    // ============================================================
    console.log("\n🔄 STEP 6: Converting to budget entries (calculateBudgetSummary logic)...");

    const budgetEntries = budgetPeriodsSnap.docs.map(doc => {
      const period = doc.data();
      const allocatedAmount = period.modifiedAmount || period.allocatedAmount;
      const spentAmount = period.spent || 0;
      const remainingAmount = allocatedAmount - spentAmount;

      return {
        budgetId: period.budgetId,
        budgetPeriodId: period.id || doc.id,
        budgetName: period.budgetName || "Unnamed Budget",
        maxAmount: allocatedAmount,
        totalSpent: spentAmount,
        totalRemaining: remainingAmount,
        progressPercentage: allocatedAmount > 0
          ? Math.round((spentAmount / allocatedAmount) * 100)
          : 0,
        isOverBudget: spentAmount > allocatedAmount,
        groupId: period.groupIds?.[0] || ""
      };
    });

    results.step6_calculateEntries = {
      success: true,
      entriesCreated: budgetEntries.length,
      entries: budgetEntries
    };

    console.log(`   ✓ Created ${budgetEntries.length} budget entries`);
    if (budgetEntries.length > 0) {
      budgetEntries.forEach((entry, idx) => {
        console.log(`\n   Entry ${idx + 1}:`);
        console.log(`     - budgetName: ${entry.budgetName}`);
        console.log(`     - maxAmount: $${entry.maxAmount}`);
        console.log(`     - totalSpent: $${entry.totalSpent}`);
        console.log(`     - totalRemaining: $${entry.totalRemaining}`);
      });
    }

    // ============================================================
    // STEP 7: Show what WOULD be written to user_summaries
    // ============================================================
    console.log("\n💾 STEP 7: What would be written to user_summaries...");

    results.step7_finalSummary = {
      documentId: expectedSummaryId,
      budgetsArrayLength: budgetEntries.length,
      budgetsArray: budgetEntries
    };

    if (budgetEntries.length === 0) {
      console.log("   ⚠️  budgets: [] (empty array)");
      console.log("   This matches what you're seeing in Firestore!");
    } else {
      console.log(`   ✓ budgets: [${budgetEntries.length} entries]`);
    }

    // ============================================================
    // SUMMARY & DIAGNOSIS
    // ============================================================
    console.log("\n" + "=".repeat(80));
    console.log("📋 DIAGNOSIS SUMMARY");
    console.log("=".repeat(80));

    if (budgetPeriodsSnap.empty) {
      console.log("\n🔴 PROBLEM IDENTIFIED:");
      console.log("   The query in fetchBudgetsBatch() returns 0 documents");
      console.log("\n   Root cause: One of these conditions is not met:");
      console.log(`   - userId: "${userId}"`);
      console.log(`   - sourcePeriodId: "${sourcePeriodId}"`);
      console.log(`   - isActive: true`);
      console.log("\n   Next steps:");
      console.log("   1. Check the budget_period document in Firestore");
      console.log("   2. Verify userId matches exactly (no extra spaces/characters)");
      console.log("   3. Verify sourcePeriodId format matches exactly");
      console.log("   4. Confirm isActive is boolean true (not string 'true')");
    } else if (!summarySnap.exists) {
      console.log("\n🟡 POTENTIAL ISSUE:");
      console.log("   user_summaries document doesn't exist");
      console.log("   Pre-creation may have failed or period outside range");
      console.log("\n   Next steps:");
      console.log("   1. Check if preCreateUserPeriodSummaries ran for this user");
      console.log("   2. Verify the period range (should be ±12 periods from current)");
    } else if (budgetEntries.length > 0) {
      console.log("\n🟢 NO ISSUES DETECTED:");
      console.log("   Everything should work correctly");
      console.log("   The trigger should update user_summaries with budget data");
    } else {
      console.log("\n🟠 UNEXPECTED STATE:");
      console.log("   Query succeeded but returned 0 documents");
    }

    console.log("\n" + "=".repeat(80));

    return {
      success: true,
      diagnosis: budgetPeriodsSnap.empty ? "QUERY_RETURNS_ZERO_DOCUMENTS" : "OK",
      results
    };

  } catch (error) {
    console.error("\n❌ ERROR during debugging:", error);
    results.errors.push(error instanceof Error ? error.message : String(error));

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      results
    };
  }
});
