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
exports.createTestBudget = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../types");
const documentStructure_1 = require("../../../utils/documentStructure");
const uuid_1 = require("uuid");
const db = admin.firestore();
/**
 * DEV FUNCTION: Create Test Budget
 *
 * Creates a test budget with configurable parameters for frontend testing.
 * This function allows developers to quickly create budgets and verify:
 * 1. Budget periods are generated correctly
 * 2. User_summaries are updated with budget data
 * 3. Spending calculations work properly
 *
 * IMPORTANT: This function should only be used in development/staging environments.
 *
 * @param request.data.amount - Budget amount (default: 500)
 * @param request.data.name - Budget name (default: "Test Budget")
 * @param request.data.period - Budget period (default: "MONTHLY")
 * @param request.data.categoryIds - Category IDs (default: [])
 * @param request.data.startDate - Start date (default: current month start)
 * @param request.data.endDate - End date (default: 1 year from start)
 * @param request.data.isSystemEverythingElse - Create as "Everything Else" budget (default: false)
 * @param request.data.currency - Currency code (default: "USD")
 *
 * @returns {object} Created budget details and summary of generated periods
 */
exports.createTestBudget = (0, https_1.onCall)(async (request) => {
    // Authentication required
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const userId = request.auth.uid;
    // Extract parameters with defaults
    const { amount = 500, name = "Test Budget", period = types_1.BudgetPeriod.MONTHLY, categoryIds = [], startDate, endDate, isSystemEverythingElse = false, groupId, currency = "USD", } = request.data || {};
    console.log(`[createTestBudget] Creating test budget for user: ${userId}`, {
        amount,
        name,
        period,
        isSystemEverythingElse,
    });
    try {
        // Calculate default dates if not provided
        const now = new Date();
        const defaultStartDate = startDate
            ? firestore_1.Timestamp.fromDate(new Date(startDate))
            : firestore_1.Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), 1)); // First of current month
        const oneYearLater = new Date(defaultStartDate.toDate());
        oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
        const defaultEndDate = endDate
            ? firestore_1.Timestamp.fromDate(new Date(endDate))
            : firestore_1.Timestamp.fromDate(oneYearLater);
        // Convert single groupId to groupIds array
        const groupIds = groupId ? [groupId] : [];
        // Create budget document
        const budgetId = (0, uuid_1.v4)();
        const budget = {
            id: budgetId,
            userId,
            groupIds,
            isActive: true,
            createdAt: firestore_1.Timestamp.now(),
            updatedAt: firestore_1.Timestamp.now(),
            // Nested access control
            access: (0, documentStructure_1.buildAccessControl)(userId, userId, groupIds),
            // Budget details
            name,
            amount,
            currency,
            categoryIds,
            period,
            // Date range
            startDate: defaultStartDate,
            endDate: defaultEndDate,
            // Budget type
            budgetType: 'recurring',
            isOngoing: true,
            // Spending tracking
            spent: 0,
            remaining: amount,
            alertThreshold: 80,
            // System budget flag
            isSystemEverythingElse,
            // Metadata
            description: `Test budget created for development/testing - ${new Date().toISOString()}`,
        };
        // Save to Firestore
        await db.collection("budgets").doc(budgetId).set(budget);
        console.log(`[createTestBudget] Budget created successfully: ${budgetId}`);
        // Wait a moment for triggers to fire
        await new Promise((resolve) => setTimeout(resolve, 2000));
        // Query generated budget periods
        const periodsSnapshot = await db
            .collection("budget_periods")
            .where("budgetId", "==", budgetId)
            .get();
        const periods = periodsSnapshot.docs.map((doc) => ({
            id: doc.id,
            periodId: doc.data().periodId,
            periodType: doc.data().periodType,
            periodStart: doc.data().periodStart,
            periodEnd: doc.data().periodEnd,
            allocatedAmount: doc.data().allocatedAmount,
            spent: doc.data().spent || 0,
            remaining: doc.data().remaining || doc.data().allocatedAmount,
        }));
        // Query user_summaries to check if budget appears
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
                hasBudgetEntry: !!matchingBudget,
                budgetEntry: matchingBudget || null,
            };
        });
        // Return comprehensive test results
        return {
            success: true,
            message: "Test budget created successfully",
            budget: {
                id: budgetId,
                name,
                amount,
                currency,
                period,
                isSystemEverythingElse,
                startDate: defaultStartDate.toDate().toISOString(),
                endDate: defaultEndDate.toDate().toISOString(),
                categoryIds,
                groupIds,
            },
            periods: {
                count: periods.length,
                breakdown: {
                    MONTHLY: periods.filter((p) => p.periodType === types_1.PeriodType.MONTHLY)
                        .length,
                    BI_MONTHLY: periods.filter((p) => p.periodType === types_1.PeriodType.BI_MONTHLY).length,
                    WEEKLY: periods.filter((p) => p.periodType === types_1.PeriodType.WEEKLY)
                        .length,
                },
                samples: periods.slice(0, 3), // First 3 periods as samples
            },
            userSummaries: {
                count: summaries.length,
                summariesWithBudget: summaries.filter((s) => s.hasBudgetEntry).length,
                samples: summaries.filter((s) => s.hasBudgetEntry).slice(0, 2),
            },
            testingInstructions: {
                step1: `Budget created with ID: ${budgetId}`,
                step2: `${periods.length} budget periods generated`,
                step3: `Check user_summaries for budget entries`,
                step4: `Create transactions to test spending updates`,
                step5: `Verify user_summaries.budgets[].totalSpent updates correctly`,
            },
        };
    }
    catch (error) {
        console.error("[createTestBudget] Error creating test budget:", error);
        throw new https_1.HttpsError("internal", `Failed to create test budget: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
});
//# sourceMappingURL=createTestBudget.js.map