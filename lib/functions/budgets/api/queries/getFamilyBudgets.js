"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFamilyBudgets = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
const auth_1 = require("../../../../utils/auth");
/**
 * Get family budgets.
 *
 * Callable (onCall): use the Firebase Functions SDK (httpsCallable). Returns the
 * Budget[] directly. Users without a family get a `failed-precondition` error whose
 * message contains "User must belong to a family" — the client detects this and
 * falls back to personal budgets.
 */
exports.getFamilyBudgets = (0, https_1.onCall)({
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
    if (!userData.familyId) {
        // Message preserved for the client's no-family fallback detection
        throw new https_1.HttpsError("failed-precondition", "User must belong to a family");
    }
    try {
        const data = (request.data || {});
        const includeInactive = data.includeInactive === true || data.includeInactive === "true";
        const limit = Number(data.limit) || 50;
        const offset = Number(data.offset) || 0;
        // Build query conditions
        const whereConditions = [
            { field: "familyId", operator: "==", value: userData.familyId },
        ];
        if (!includeInactive) {
            whereConditions.push({ field: "isActive", operator: "==", value: "true" });
        }
        // Query budgets
        const budgets = await (0, firestore_1.queryDocuments)("budgets", {
            where: whereConditions,
            orderBy: "createdAt",
            orderDirection: "desc",
            limit,
            offset,
        });
        // Update spent amounts for all budgets
        const updatedBudgets = await Promise.all(budgets.map(budget => updateBudgetSpentAmount(budget)));
        return updatedBudgets;
    }
    catch (error) {
        console.error("Error getting family budgets:", error);
        throw new https_1.HttpsError("internal", "Failed to get family budgets");
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
//# sourceMappingURL=getFamilyBudgets.js.map