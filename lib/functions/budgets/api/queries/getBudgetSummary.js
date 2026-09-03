"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBudgetSummary = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
const auth_1 = require("../../../../utils/auth");
/**
 * Get budget spending summary.
 *
 * Callable (onCall): use the Firebase Functions SDK (httpsCallable). Returns the
 * summary object directly. Pass `{ id: budgetId }` in the callable payload.
 */
exports.getBudgetSummary = (0, https_1.onCall)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
    cors: true
}, async (request) => {
    var _a;
    const budgetId = ((_a = request.data) === null || _a === void 0 ? void 0 : _a.id) || "";
    if (!budgetId) {
        throw new https_1.HttpsError("invalid-argument", "Budget ID is required");
    }
    // Authenticate (callable-aware helper reads request.auth)
    let userData;
    try {
        ({ userData } = await (0, auth_1.authenticateRequest)(request, types_1.UserRole.VIEWER));
    }
    catch (error) {
        throw new https_1.HttpsError("unauthenticated", (error === null || error === void 0 ? void 0 : error.message) || "Authentication required");
    }
    try {
        // Get budget
        const budget = await (0, firestore_1.getDocument)("budgets", budgetId);
        if (!budget) {
            throw new https_1.HttpsError("not-found", "Budget not found");
        }
        // Check access - for individual budgets check ownership/membership, for shared budgets check family access
        if (budget.isShared && budget.familyId) {
            // Shared budget - check family access
            if (!await (0, auth_1.checkFamilyAccess)(userData.id, budget.familyId)) {
                throw new https_1.HttpsError("permission-denied", "Cannot access this family budget");
            }
        }
        else {
            // Individual budget - check ownership or membership
            if (budget.createdBy !== userData.id && !(budget.memberIds || []).includes(userData.id)) {
                throw new https_1.HttpsError("permission-denied", "Cannot access this budget");
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
        return summary;
    }
    catch (error) {
        // Preserve intentional HttpsErrors (not-found, permission-denied, …)
        if (error instanceof https_1.HttpsError)
            throw error;
        console.error("Error getting budget summary:", error);
        throw new https_1.HttpsError("internal", "Failed to get budget summary");
    }
});
//# sourceMappingURL=getBudgetSummary.js.map