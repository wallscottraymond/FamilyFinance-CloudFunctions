import { getFirestore } from "firebase-admin/firestore";
import { BudgetPeriodDocument } from "../../../types";

const db = getFirestore();

/**
 * Fetches all budget periods for a user in a specific source period
 *
 * This function queries the budget_periods collection to retrieve all
 * budget periods that belong to a specific user and source period.
 *
 * @param userId - The user ID
 * @param sourcePeriodId - The period ID (e.g., "2025-M11")
 * @returns Array of BudgetPeriodDocument documents
 */
export async function fetchBudgetsBatch(
  userId: string,
  sourcePeriodId: string
): Promise<BudgetPeriodDocument[]> {
  console.log(
    `[fetchBudgetsBatch] Fetching budget periods for user: ${userId}, period: ${sourcePeriodId}`
  );

  try {
    const budgetPeriodsSnapshot = await db
      .collection("budget_periods")
      .where("userId", "==", userId)
      .where("sourcePeriodId", "==", sourcePeriodId)
      .where("isActive", "==", true)
      .get();

    const budgetPeriods = budgetPeriodsSnapshot.docs.map(
      (doc) => doc.data() as BudgetPeriodDocument
    );

    console.log(
      `[fetchBudgetsBatch] Found ${budgetPeriods.length} budget periods`
    );

    return budgetPeriods;
  } catch (error) {
    console.error(`[fetchBudgetsBatch] Error fetching budget periods:`, error);
    throw new Error(
      `Failed to fetch budget periods for user ${userId} in period ${sourcePeriodId}: ${error}`
    );
  }
}
