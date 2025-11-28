"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchBudgetsBatch = fetchBudgetsBatch;
const firestore_1 = require("firebase-admin/firestore");
const db = (0, firestore_1.getFirestore)();
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
async function fetchBudgetsBatch(userId, sourcePeriodId) {
    console.log(`[fetchBudgetsBatch] Fetching budget periods for user: ${userId}, period: ${sourcePeriodId}`);
    try {
        const budgetPeriodsSnapshot = await db
            .collection("budget_periods")
            .where("userId", "==", userId)
            .where("sourcePeriodId", "==", sourcePeriodId)
            .where("isActive", "==", true)
            .get();
        const budgetPeriods = budgetPeriodsSnapshot.docs.map((doc) => doc.data());
        console.log(`[fetchBudgetsBatch] Found ${budgetPeriods.length} budget periods`);
        return budgetPeriods;
    }
    catch (error) {
        console.error(`[fetchBudgetsBatch] Error fetching budget periods:`, error);
        throw new Error(`Failed to fetch budget periods for user ${userId} in period ${sourcePeriodId}: ${error}`);
    }
}
//# sourceMappingURL=fetchBudgetsBatch.js.map