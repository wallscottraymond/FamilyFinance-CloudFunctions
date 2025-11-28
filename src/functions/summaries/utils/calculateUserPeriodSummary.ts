import { Timestamp } from "firebase-admin/firestore";
import { UserPeriodSummary } from "../../../types/periodSummaries";
import { fetchSourcePeriod } from "./fetchSourcePeriod";
import { fetchOutflowsBatch } from "./fetchOutflowsBatch";
import { fetchBudgetsBatch } from "./fetchBudgetsBatch";
import { fetchInflowsBatch } from "./fetchInflowsBatch";
import { calculateOutflowSummary } from "./calculateOutflowSummary";
import { calculateBudgetSummary } from "./calculateBudgetSummary";
import { calculateInflowSummary } from "./calculateInflowSummary";
import { calculateGoalSummary } from "./calculateGoalSummary";

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
export async function calculateUserPeriodSummary(
  userId: string,
  periodType: string,
  sourcePeriodId: string,
  includeEntries: boolean = false
): Promise<UserPeriodSummary> {
  console.log(
    `[calculateUserPeriodSummary] Calculating summary for user: ${userId}, period: ${sourcePeriodId}, type: ${periodType}`
  );

  const startTime = Date.now();

  // Step 1: Fetch source period for context
  const sourcePeriod = await fetchSourcePeriod(sourcePeriodId);

  // Step 2: Fetch all resource periods in parallel
  const [outflowPeriods, budgetPeriods, inflowPeriods] = await Promise.all([
    fetchOutflowsBatch(userId, sourcePeriodId),
    fetchBudgetsBatch(userId, sourcePeriodId),
    fetchInflowsBatch(userId, sourcePeriodId),
  ]);

  console.log(`[calculateUserPeriodSummary] Fetched resource periods:`, {
    outflowPeriods: outflowPeriods.length,
    budgetPeriods: budgetPeriods.length,
    inflowPeriods: inflowPeriods.length,
  });

  // Step 3: Calculate summaries for each resource type
  const outflows = calculateOutflowSummary(outflowPeriods, includeEntries);
  const budgets = calculateBudgetSummary(budgetPeriods, includeEntries);
  const inflows = calculateInflowSummary(inflowPeriods, includeEntries);
  const goals = calculateGoalSummary(includeEntries); // Stub for now

  // Step 4: Calculate cross-resource metrics
  const totalIncome = inflows.totalReceivedIncome;

  // Total expenses = outflows paid + budgets spent
  const totalExpenses = outflows.totalAmountPaid + budgets.totalSpent;

  // Net cash flow = income - expenses
  const netCashFlow = totalIncome - totalExpenses;

  // Savings rate = (income - expenses) / income
  // Avoid division by zero
  const savingsRate = totalIncome > 0 ? netCashFlow / totalIncome : 0;

  // Step 5: Build the complete UserPeriodSummary
  const now = Timestamp.now();

  // Build document ID: {userId}_{periodType}_{sourcePeriodId}
  const summaryId = `${userId}_${periodType}_${sourcePeriodId}`;

  const summary: UserPeriodSummary = {
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

    // === AGGREGATED RESOURCE DATA ===
    outflows,
    budgets,
    inflows,
    goals,

    // === CROSS-RESOURCE METRICS ===
    totalIncome,
    totalExpenses,
    netCashFlow,
    savingsRate,

    // === METADATA ===
    lastRecalculated: now,
    createdAt: now,
    updatedAt: now,
  };

  const duration = Date.now() - startTime;

  console.log(`[calculateUserPeriodSummary] Summary calculated in ${duration}ms:`, {
    summaryId,
    totalIncome,
    totalExpenses,
    netCashFlow,
    savingsRate: `${(savingsRate * 100).toFixed(1)}%`,
    resourceCounts: {
      outflows: outflows.totalCount,
      budgets: budgets.totalCount,
      inflows: inflows.totalCount,
      goals: goals.totalCount,
    },
  });

  return summary;
}
