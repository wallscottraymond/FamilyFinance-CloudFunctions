"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPersonalBudgets = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
const auth_1 = require("../../../../utils/auth");
/**
 * Get personal budgets for individual users (not family-based)
 * This function works for users regardless of family membership.
 *
 * Callable (onCall): use the Firebase Functions SDK (httpsCallable) — the client
 * no longer hand-builds URLs or attaches tokens. Returns the Budget[] directly.
 */
exports.getPersonalBudgets = (0, https_1.onCall)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
    cors: true
}, async (request) => {
    // Authenticate (callable-aware helper reads request.auth)
    let userData;
    try {
        ({ userData } = await (0, auth_1.authenticateRequest)(request, types_1.UserRole.VIEWER));
    }
    catch (error) {
        throw new https_1.HttpsError("unauthenticated", (error === null || error === void 0 ? void 0 : error.message) || "Authentication required");
    }
    try {
        // Optional filters from the callable payload
        const { startDate, endDate, category, isActive } = (request.data || {});
        // Build query conditions
        const whereConditions = [
            { field: "createdBy", operator: "==", value: userData.id },
        ];
        if (startDate) {
            whereConditions.push({ field: "startDate", operator: ">=", value: startDate });
        }
        if (endDate) {
            whereConditions.push({ field: "endDate", operator: "<=", value: endDate });
        }
        if (category) {
            whereConditions.push({ field: "categoryIds", operator: "array-contains", value: category });
        }
        if (isActive !== undefined) {
            whereConditions.push({
                field: "isActive",
                operator: "==",
                value: isActive === true || isActive === 'true'
            });
        }
        // Query personal budgets created by this user
        const budgets = await (0, firestore_1.queryDocuments)("budgets", {
            where: whereConditions,
            orderBy: "createdAt",
            orderDirection: "desc",
        });
        console.log(`[getPersonalBudgets] Found ${budgets.length} personal budgets for user ${userData.id}`);
        // Update spent amounts for all budgets (optional - can be disabled for performance)
        const updatedBudgets = await Promise.all(budgets.map(budget => updateBudgetSpentAmount(budget)));
        return updatedBudgets;
    }
    catch (error) {
        console.error("Error getting personal budgets:", error);
        throw new https_1.HttpsError("internal", "Failed to get personal budgets");
    }
});
/**
 * Helper function to update budget spent amount
 */
async function updateBudgetSpentAmount(budget) {
    try {
        // Get all approved expense transactions for this budget
        const transactions = await (0, firestore_1.queryDocuments)("transactions", {
            where: [
                { field: "budgetId", operator: "==", value: budget.id },
                { field: "status", operator: "==", value: "approved" },
                { field: "type", operator: "==", value: "expense" },
                { field: "date", operator: ">=", value: budget.startDate },
                { field: "date", operator: "<=", value: budget.endDate },
            ],
        });
        const totalSpent = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);
        const remaining = budget.amount - totalSpent;
        // Update budget if spent amount has changed
        if (totalSpent !== budget.spent) {
            const updatedBudget = await (0, firestore_1.updateDocument)("budgets", budget.id, {
                spent: totalSpent,
                remaining,
            });
            return updatedBudget;
        }
        return budget;
    }
    catch (error) {
        console.error("Error updating budget spent amount:", error);
        return budget;
    }
}
//# sourceMappingURL=getPersonalBudgets.js.map