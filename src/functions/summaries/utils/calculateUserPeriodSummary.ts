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

  // Step 3: Convert resource periods to entry arrays
  const outflows = calculateOutflowSummary(outflowPeriods);
  const budgets = calculateBudgetSummary(budgetPeriods);
  const inflows = calculateInflowSummary(inflowPeriods);
  const goals = calculateGoalSummary(); // Stub for now

  // NOTE: Cross-resource metrics (totalIncome, totalExpenses, netCashFlow, savingsRate)
  // are calculated on-the-fly in the frontend from the arrays above

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
