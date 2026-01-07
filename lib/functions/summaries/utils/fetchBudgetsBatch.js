"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchBudgetsBatch = fetchBudgetsBatch;
const firestore_1 = require("firebase-admin/firestore");
const db = (0, firestore_1.getFirestore)();
/**
 * Fetches all budget periods for a user in a specific source period and period type
 *
 * This function queries the budget_periods collection to retrieve all
 * budget periods that belong to a specific user, source period, and period type.
 * This ensures that only budgets matching the viewed period type are included.
 *
 * @param userId - The user ID
 * @param sourcePeriodId - The period ID (e.g., "2025-M11")
 * @param periodType - The period type (e.g., "MONTHLY", "BI_MONTHLY", "WEEKLY")
 * @returns Array of BudgetPeriodDocument documents
 */
async function fetchBudgetsBatch(userId, sourcePeriodId, periodType) {
    console.log(`[fetchBudgetsBatch] Fetching budget periods for user: ${userId}, period: ${sourcePeriodId}, type: ${periodType}`);
    try {
        const budgetPeriodsSnapshot = await db
            .collection("budget_periods")
            .where("userId", "==", userId)
            .where("sourcePeriodId", "==", sourcePeriodId)
            .where("periodType", "==", periodType)
            .where("isActive", "==", true)
            .get();
        const budgetPeriods = budgetPeriodsSnapshot.docs.map((doc) => doc.data());
        console.log(`[fetchBudgetsBatch] Found ${budgetPeriods.length} budget periods for ${periodType}`);
        return budgetPeriods;
    }
    catch (error) {
        console.error(`[fetchBudgetsBatch] Error fetching budget periods:`, error);
        throw new Error(`Failed to fetch budget periods for user ${userId} in period ${sourcePeriodId} (${periodType}): ${error}`);
    }
}
//# sourceMappingURL=fetchBudgetsBatch.js.map