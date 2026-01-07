"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateUserPeriodSummary = calculateUserPeriodSummary;
const firestore_1 = require("firebase-admin/firestore");
const fetchSourcePeriod_1 = require("./fetchSourcePeriod");
const fetchOutflowsBatch_1 = require("./fetchOutflowsBatch");
const fetchBudgetsBatch_1 = require("./fetchBudgetsBatch");
const fetchInflowsBatch_1 = require("./fetchInflowsBatch");
const calculateOutflowSummary_1 = require("./calculateOutflowSummary");
const calculateBudgetSummary_1 = require("./calculateBudgetSummary");
const calculateInflowSummary_1 = require("./calculateInflowSummary");
const calculateGoalSummary_1 = require("./calculateGoalSummary");
/**
 * Calculates a complete user period summary
 *
 * This is the main orchestration function that:
 * 1. Fetches the source period for context (dates, year, month, etc.)
 * 2. Fetches all resource periods (outflows, budgets, inflows)
 * 3. Calculates summaries for each resource type
 * 4. Calculates cross-resource metrics (income, expenses, net cash flow, savings rate)
 * 5. Builds the complete UserPeriodSummary object
 *
 * @param userId - The user ID
 * @param periodType - The period type (MONTHLY, WEEKLY, BI_MONTHLY)
 * @param sourcePeriodId - The source period ID (e.g., "2025-M11")
 * @param includeEntries - Whether to include detailed entries (default: false)
 * @returns Complete UserPeriodSummary object
 */
async function calculateUserPeriodSummary(userId, periodType, sourcePeriodId, includeEntries = false) {
    console.log(`[calculateUserPeriodSummary] Calculating summary for user: ${userId}, period: ${sourcePeriodId}, type: ${periodType}`);
    const startTime = Date.now();
    // Step 1: Fetch source period for context
    const sourcePeriod = await (0, fetchSourcePeriod_1.fetchSourcePeriod)(sourcePeriodId);
    // Step 2: Fetch all resource periods in parallel
    const [outflowPeriods, budgetPeriods, inflowPeriods] = await Promise.all([
        (0, fetchOutflowsBatch_1.fetchOutflowsBatch)(userId, sourcePeriodId),
        (0, fetchBudgetsBatch_1.fetchBudgetsBatch)(userId, sourcePeriodId, periodType),
        (0, fetchInflowsBatch_1.fetchInflowsBatch)(userId, sourcePeriodId),
    ]);
    console.log(`[calculateUserPeriodSummary] Fetched resource periods:`, {
        outflowPeriods: outflowPeriods.length,
        budgetPeriods: budgetPeriods.length,
        inflowPeriods: inflowPeriods.length,
    });
    // Step 3: Convert resource periods to entry arrays
    const outflows = (0, calculateOutflowSummary_1.calculateOutflowSummary)(outflowPeriods);
    const budgets = (0, calculateBudgetSummary_1.calculateBudgetSummary)(budgetPeriods);
    const inflows = (0, calculateInflowSummary_1.calculateInflowSummary)(inflowPeriods);
    const goals = (0, calculateGoalSummary_1.calculateGoalSummary)(); // Stub for now
    // NOTE: Cross-resource metrics (totalIncome, totalExpenses, netCashFlow, savingsRate)
    // are calculated on-the-fly in the frontend from the arrays above
    // Step 5: Build the complete UserPeriodSummary
    const now = firestore_1.Timestamp.now();
    // Build document ID: {userId}_{periodType}_{sourcePeriodId}
    const summaryId = `${userId}_${periodType}_${sourcePeriodId}`;
    const summary = {
        // === IDENTITY ===
        id: summaryId,
        userId,
        sourcePeriodId,
        periodType: sourcePeriod.type,
        // === PERIOD CONTEXT (from source period) ===
        periodStartDate: sourcePeriod.startDate,
        periodEndDate: sourcePeriod.endDate,
        year: sourcePeriod.year,
        month: sourcePeriod.metadata.month,
        weekNumber: sourcePeriod.metadata.weekNumber,
        // === RESOURCE ENTRIES (Arrays) ===
        outflows,
        budgets,
        inflows,
        goals,
        // === METADATA ===
        lastRecalculated: now,
        createdAt: now,
        updatedAt: now,
    };
    const duration = Date.now() - startTime;
    console.log(`[calculateUserPeriodSummary] Summary calculated in ${duration}ms:`, {
        summaryId,
        resourceCounts: {
            outflows: outflows.length,
            budgets: budgets.length,
            inflows: inflows.length,
            goals: goals.length,
        },
    });
    return summary;
}
//# sourceMappingURL=calculateUserPeriodSummary.js.map