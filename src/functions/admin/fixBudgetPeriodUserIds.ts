import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

const db = getFirestore();

/**
 * ADMIN: Fix Budget Period UserIds
 *
 * This function fixes budget_periods that are missing the userId field
 * by reading the parent budget's access.createdBy field and populating it.
 *
 * Usage:
 * firebase functions:call fixBudgetPeriodUserIds
 */
export const fixBudgetPeriodUserIds = onCall(async (request) => {
  console.log("=".repeat(80));
  console.log("🔧 ADMIN: Fixing Budget Period UserIds");
  console.log("=".repeat(80));

  try {
    // Step 1: Find all budget_periods missing userId
    console.log("\n📋 Step 1: Finding budget_periods without userId...");

    const budgetPeriodsSnapshot = await db.collection("budget_periods").get();

    const missingUserIds: any[] = [];

    budgetPeriodsSnapshot.forEach(doc => {
      const data = doc.data();
      if (!data.userId) {
        missingUserIds.push({
          id: doc.id,
          budgetId: data.budgetId
        });
      }
    });

    console.log(`   Found ${missingUserIds.length} budget_periods missing userId`);

    if (missingUserIds.length === 0) {
      return {
        success: true,
        message: "No budget_periods need fixing",
        fixed: 0
      };
    }

    // Step 2: For each one, fetch the parent budget and get createdBy
    console.log("\n🔄 Step 2: Fetching parent budgets and updating...");

    const batch = db.batch();
    let fixed = 0;
    let errors = 0;

    for (const periodInfo of missingUserIds) {
      try {
        // Fetch parent budget
        const budgetRef = db.collection("budgets").doc(periodInfo.budgetId);
        const budgetSnap = await budgetRef.get();

        if (!budgetSnap.exists) {
          console.error(`   ✗ Budget ${periodInfo.budgetId} not found`);
          errors++;
          continue;
        }

        const budget = budgetSnap.data();

        // Get userId from nested access.createdBy or root createdBy
        const userId = budget?.access?.createdBy || budget?.createdBy;

        if (!userId) {
          console.error(`   ✗ Budget ${periodInfo.budgetId} has no createdBy field`);
          errors++;
          continue;
        }

        // Update budget_period with userId
        const periodRef = db.collection("budget_periods").doc(periodInfo.id);
        batch.update(periodRef, {
          userId,
          updatedAt: new Date()
        });

        console.log(`   ✓ Will update ${periodInfo.id} with userId: ${userId}`);
        fixed++;

      } catch (error) {
        console.error(`   ✗ Error processing ${periodInfo.id}:`, error);
        errors++;
      }
    }

    // Step 3: Commit batch
    console.log(`\n💾 Step 3: Committing batch update (${fixed} documents)...`);
    await batch.commit();

    console.log("\n" + "=".repeat(80));
    console.log("✅ COMPLETE");
    console.log("=".repeat(80));
    console.log(`Fixed: ${fixed}`);
    console.log(`Errors: ${errors}`);
    console.log(`Total processed: ${missingUserIds.length}`);

    return {
      success: true,
      message: `Fixed ${fixed} budget_periods`,
      fixed,
      errors,
      total: missingUserIds.length
    };

  } catch (error) {
    console.error("\n❌ Fatal error:", error);
    throw new HttpsError(
      "internal",
      `Failed to fix budget periods: ${error instanceof Error ? error.message : String(error)}`
    );
  }
});
