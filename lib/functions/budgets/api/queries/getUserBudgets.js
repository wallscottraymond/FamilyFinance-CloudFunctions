"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserBudgets = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
const auth_1 = require("../../../../utils/auth");
const cors_1 = require("../../../../middleware/cors");
/**
 * Get user budgets (budgets user is a member of)
 */
exports.getUserBudgets = (0, https_1.onRequest)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
    cors: true
}, async (request, response) => {
    return (0, cors_1.firebaseCors)(request, response, async () => {
        if (request.method !== "GET") {
            return response.status(405).json((0, auth_1.createErrorResponse)("method-not-allowed", "Only GET requests are allowed"));
        }
        try {
            // Authenticate user
            const authResult = await (0, auth_1.authMiddleware)(request, types_1.UserRole.VIEWER);
            if (!authResult.success || !authResult.user) {
                return response.status(401).json(authResult.error);
            }
            const { user } = authResult;
            const targetUserId = request.query.userId || user.id;
            if (!user.familyId) {
                return response.status(400).json((0, auth_1.createErrorResponse)("no-family", "User must belong to a family"));
            }
            // Query budgets where user is a member
            const budgets = await (0, firestore_1.queryDocuments)("budgets", {
                where: [
                    { field: "familyId", operator: "==", value: user.familyId },
                    { field: "memberIds", operator: "array-contains", value: targetUserId },
                    { field: "isActive", operator: "==", value: true },
                ],
                orderBy: "createdAt",
                orderDirection: "desc",
            });
            // Update spent amounts for all budgets
            const updatedBudgets = await Promise.all(budgets.map(budget => updateBudgetSpentAmount(budget)));
            return response.status(200).json((0, auth_1.createSuccessResponse)(updatedBudgets));
        }
        catch (error) {
            console.error("Error getting user budgets:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to get user budgets"));
        }
    });
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
//# sourceMappingURL=getUserBudgets.js.map