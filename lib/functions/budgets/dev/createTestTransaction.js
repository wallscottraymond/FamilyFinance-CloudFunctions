"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTestTransaction = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const uuid_1 = require("uuid");
const db = admin.firestore();
/**
 * DEV FUNCTION: Create Test Transaction
 *
 * Creates a test transaction linked to a budget for testing spending calculations.
 * This allows developers to verify:
 * 1. Transaction creation works
 * 2. Budget spending is updated (via updateBudgetSpending trigger)
 * 3. User_summaries.budgets[].totalSpent reflects the change
 *
 * IMPORTANT: This function should only be used in development/staging environments.
 *
 * @param request.data.budgetId - Budget ID to link transaction to
 * @param request.data.amount - Transaction amount (default: 50)
 * @param request.data.description - Transaction description (default: "Test Transaction")
 * @param request.data.date - Transaction date (default: now)
 * @param request.data.categoryId - Category ID (optional)
 *
 * @returns {object} Created transaction details and updated budget period info
 */
exports.createTestTransaction = (0, https_1.onCall)(async (request) => {
    var _a;
    // Authentication required
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const userId = request.auth.uid;
    // Extract parameters
    const { budgetId, amount = 50, description = "Test Transaction", date, categoryId, groupId, } = request.data || {};
    // Validate required fields
    if (!budgetId) {
        throw new https_1.HttpsError("invalid-argument", "budgetId is required to create a test transaction");
    }
    console.log(`[createTestTransaction] Creating test transaction for budget: ${budgetId}`, {
        amount,
        description,
    });
    try {
        // Verify budget exists and belongs to user
        const budgetDoc = await db.collection("budgets").doc(budgetId).get();
        if (!budgetDoc.exists) {
            throw new https_1.HttpsError("not-found", `Budget not found: ${budgetId}`);
        }
        const budgetData = budgetDoc.data();
        if ((budgetData === null || budgetData === void 0 ? void 0 : budgetData.userId) !== userId) {
            throw new https_1.HttpsError("permission-denied", "Budget does not belong to authenticated user");
        }
        // Get budget category if not provided
        const transactionCategoryId = categoryId || ((_a = budgetData === null || budgetData === void 0 ? void 0 : budgetData.categoryIds) === null || _a === void 0 ? void 0 : _a[0]) || "uncategorized";
        // Convert single groupId to groupIds array
        const groupIds = groupId ? [groupId] : (budgetData === null || budgetData === void 0 ? void 0 : budgetData.groupIds) || [];
        // Calculate transaction date
        const transactionDate = date
            ? firestore_1.Timestamp.fromDate(new Date(date))
            : firestore_1.Timestamp.now();
        // Find matching budget period
        const periodsSnapshot = await db
            .collection("budget_periods")
            .where("budgetId", "==", budgetId)
            .where("periodStart", "<=", transactionDate)
            .where("periodEnd", ">=", transactionDate)
            .limit(1)
            .get();
        let matchingPeriodId = null;
        let matchingPeriod = null;
        if (!periodsSnapshot.empty) {
            const periodDoc = periodsSnapshot.docs[0];
            matchingPeriodId = periodDoc.id;
            matchingPeriod = {
                id: matchingPeriodId,
                periodId: periodDoc.data().periodId,
                periodType: periodDoc.data().periodType,
                allocatedAmount: periodDoc.data().allocatedAmount,
                spentBefore: periodDoc.data().spent || 0,
            };
        }
        // Create transaction document
        const transactionId = (0, uuid_1.v4)();
        const transaction = {
            id: transactionId,
            userId,
            groupIds,
            isActive: true,
            createdAt: firestore_1.Timestamp.now(),
            updatedAt: firestore_1.Timestamp.now(),
            // Transaction details
            amount,
            description,
            date: transactionDate,
            categoryId: transactionCategoryId,
            // Metadata
            metadata: {
                source: "test",
                notes: `Test transaction created for budget: ${(budgetData === null || budgetData === void 0 ? void 0 : budgetData.name) || budgetId}`,
                createdBy: userId,
            },
            // Link to budget
            budgetId,
            budgetPeriodId: matchingPeriodId,
            // Transaction type
            type: "expense",
            status: "completed",
        };
        // Save transaction
        await db.collection("transactions").doc(transactionId).set(transaction);
        console.log(`[createTestTransaction] Transaction created: ${transactionId}`);
        // Wait for triggers to fire (updateBudgetSpending, user_summaries update)
        await new Promise((resolve) => setTimeout(resolve, 3000));
        // Query updated budget period
        let updatedPeriod = null;
        if (matchingPeriodId) {
            const periodDoc = await db
                .collection("budget_periods")
                .doc(matchingPeriodId)
                .get();
            if (periodDoc.exists) {
                const data = periodDoc.data();
                updatedPeriod = {
                    id: matchingPeriodId,
                    periodId: data === null || data === void 0 ? void 0 : data.periodId,
                    periodType: data === null || data === void 0 ? void 0 : data.periodType,
                    allocatedAmount: data === null || data === void 0 ? void 0 : data.allocatedAmount,
                    spentAfter: (data === null || data === void 0 ? void 0 : data.spent) || 0,
                    remaining: (data === null || data === void 0 ? void 0 : data.remaining) || 0,
                    spentIncrease: ((data === null || data === void 0 ? void 0 : data.spent) || 0) - ((matchingPeriod === null || matchingPeriod === void 0 ? void 0 : matchingPeriod.spentBefore) || 0),
                };
            }
        }
        // Query user_summaries to verify update
        const summarySnapshot = await db
            .collection("user_summaries")
            .where("userId", "==", userId)
            .limit(5)
            .get();
        const summaries = summarySnapshot.docs.map((doc) => {
            const data = doc.data();
            const budgetEntries = data.budgets || [];
            const matchingBudget = budgetEntries.find((b) => b.budgetId === budgetId);
            return {
                summaryId: doc.id,
                periodType: data.periodType,
                sourcePeriodId: data.sourcePeriodId,
                budgetEntry: matchingBudget
                    ? {
                        budgetName: matchingBudget.budgetName,
                        totalAllocated: matchingBudget.totalAllocated,
                        totalSpent: matchingBudget.totalSpent,
                        totalRemaining: matchingBudget.totalRemaining,
                        progressPercentage: matchingBudget.progressPercentage,
                    }
                    : null,
            };
        });
        return {
            success: true,
            message: "Test transaction created successfully",
            transaction: {
                id: transactionId,
                amount,
                description,
                date: transactionDate.toDate().toISOString(),
                budgetId,
                budgetPeriodId: matchingPeriodId,
                categoryId: transactionCategoryId,
            },
            budgetPeriod: {
                matched: !!matchingPeriodId,
                before: matchingPeriod,
                after: updatedPeriod,
            },
            userSummaries: {
                count: summaries.length,
                samples: summaries
                    .filter((s) => s.budgetEntry !== null)
                    .slice(0, 2),
            },
            verification: {
                step1: `Transaction created: ${transactionId}`,
                step2: matchingPeriodId
                    ? `Budget period updated: ${matchingPeriodId}`
                    : "No matching budget period found",
                step3: updatedPeriod
                    ? `Spent increased by: $${updatedPeriod.spentIncrease}`
                    : "Budget period not updated",
                step4: "Check user_summaries.budgets[].totalSpent for changes",
            },
        };
    }
    catch (error) {
        console.error("[createTestTransaction] Error creating test transaction:", error);
        throw new https_1.HttpsError("internal", `Failed to create test transaction: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
});
//# sourceMappingURL=createTestTransaction.js.map