"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBudgetSummary = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
const auth_1 = require("../../../../utils/auth");
const cors_1 = require("../../../../middleware/cors");
/**
 * Get budget spending summary
 */
exports.getBudgetSummary = (0, https_1.onRequest)({
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
            // Get transactions for this budget
            const transactions = await (0, firestore_1.queryDocuments)("transactions", {
                where: [
                    { field: "budgetId", operator: "==", value: budgetId },
                    { field: "status", operator: "==", value: "approved" },
                    { field: "type", operator: "==", value: "expense" },
                ],
                orderBy: "date",
                orderDirection: "desc",
            });
            // Calculate spending by member
            const spendingByMember = {};
            let totalSpent = 0;
            transactions.forEach((transaction) => {
                const userId = transaction.userId;
                const amount = transaction.amount;
                if (!spendingByMember[userId]) {
                    spendingByMember[userId] = { amount: 0, transactionCount: 0 };
                }
                spendingByMember[userId].amount += amount;
                spendingByMember[userId].transactionCount += 1;
                totalSpent += amount;
            });
            // Get member details
            const memberIds = Object.keys(spendingByMember);
            const memberPromises = memberIds.map(id => (0, firestore_1.getDocument)("users", id));
            const members = await Promise.all(memberPromises);
            const spendingSummary = memberIds.map((memberId, index) => {
                var _a, _b;
                return ({
                    user: {
                        id: memberId,
                        displayName: ((_a = members[index]) === null || _a === void 0 ? void 0 : _a.displayName) || "Unknown",
                        email: ((_b = members[index]) === null || _b === void 0 ? void 0 : _b.email) || "Unknown",
                    },
                    spending: spendingByMember[memberId],
                    percentage: totalSpent > 0 ? (spendingByMember[memberId].amount / totalSpent) * 100 : 0,
                });
            });
            const summary = {
                budget: {
                    id: budget.id,
                    name: budget.name,
                    amount: budget.amount,
                    currency: budget.currency,
                    period: budget.period,
                    categoryIds: budget.categoryIds,
                },
                spending: {
                    total: totalSpent,
                    remaining: budget.amount - totalSpent,
                    percentage: (totalSpent / budget.amount) * 100,
                    isOverBudget: totalSpent > budget.amount,
                    alertThresholdReached: (totalSpent / budget.amount) * 100 >= budget.alertThreshold,
                },
                transactions: {
                    count: transactions.length,
                    recent: transactions.slice(0, 5), // Last 5 transactions
                },
                members: spendingSummary,
            };
            return response.status(200).json((0, auth_1.createSuccessResponse)(summary));
        }
        catch (error) {
            console.error("Error getting budget summary:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to get budget summary"));
        }
    });
});
//# sourceMappingURL=getBudgetSummary.js.map