"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBudget = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
const auth_1 = require("../../../../utils/auth");
const cors_1 = require("../../../../middleware/cors");
/**
 * Get budget by ID
 */
exports.getBudget = (0, https_1.onRequest)({
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
            const budgetId = request.query.id;
            if (!budgetId) {
                return response.status(400).json((0, auth_1.createErrorResponse)("missing-parameter", "Budget ID is required"));
            }
            // Authenticate user
            const authResult = await (0, auth_1.authMiddleware)(request, types_1.UserRole.VIEWER);
            if (!authResult.success || !authResult.user) {
                return response.status(401).json(authResult.error);
            }
            const { user } = authResult;
            // Get budget
            const budget = await (0, firestore_1.getDocument)("budgets", budgetId);
            if (!budget) {
                return response.status(404).json((0, auth_1.createErrorResponse)("budget-not-found", "Budget not found"));
            }
            // Check access - for individual budgets check ownership/membership, for shared budgets check family access
            if (budget.isShared && budget.familyId) {
                // Shared budget - check family access
                if (!await (0, auth_1.checkFamilyAccess)(user.id, budget.familyId)) {
                    return response.status(403).json((0, auth_1.createErrorResponse)("access-denied", "Cannot access this family budget"));
                }
            }
            else {
                // Individual budget - check ownership or membership
                if (budget.createdBy !== user.id && !(budget.memberIds || []).includes(user.id)) {
                    return response.status(403).json((0, auth_1.createErrorResponse)("access-denied", "Cannot access this budget"));
                }
            }
            // Calculate current spent amount and update budget if needed
            const updatedBudget = await updateBudgetSpentAmount(budget);
            return response.status(200).json((0, auth_1.createSuccessResponse)(updatedBudget));
        }
        catch (error) {
            console.error("Error getting budget:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to get budget"));
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
//# sourceMappingURL=getBudget.js.map