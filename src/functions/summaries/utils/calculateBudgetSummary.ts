import { BudgetPeriodDocument } from "../../../types";
import {
  BudgetSummaryData,
  BudgetEntry,
} from "../../../types/periodSummaries";

/**
 * Calculates budget summary data from budget periods
 *
 * Aggregates all budget periods for a given period into a summary object
 * containing totals, counts, and optional detailed entries.
 *
 * NOTE: Currently, spentAmount is set to 0 as a placeholder.
 * In a future enhancement, this should be calculated by:
 * 1. Querying transactions linked to each budget
 * 2. Summing transaction amounts that fall within the period
 * 3. Calculating actual spending against allocated amounts
 *
 * @param budgetPeriods - Array of budget periods to aggregate
 * @param includeEntries - Whether to include detailed entries (default: false)
 * @returns BudgetSummaryData object
 */
export function calculateBudgetSummary(
  budgetPeriods: BudgetPeriodDocument[],
  includeEntries: boolean = true // ALWAYS include entries for tile rendering
): BudgetSummaryData {
  console.log(
    `[calculateBudgetSummary] Calculating summary for ${budgetPeriods.length} budget periods`
  );

  // Initialize totals
  let totalAllocated = 0;
  let totalSpent = 0; // TODO: Calculate from linked transactions
  let totalRemaining = 0;

  // Initialize counts
  let totalCount = 0;
  let overBudgetCount = 0;
  let underBudgetCount = 0;

  // Initialize entries array if requested
  const entries: BudgetEntry[] = [];

  // Process each budget period
  for (const budgetPeriod of budgetPeriods) {
    // Use modified amount if available, otherwise use allocated amount
    const allocatedAmount =
      budgetPeriod.modifiedAmount || budgetPeriod.allocatedAmount;

    // TODO: Calculate actual spent amount from linked transactions
    // For now, using placeholder value of 0
    const spentAmount = 0;

    const remainingAmount = allocatedAmount - spentAmount;

    // Accumulate totals
    totalAllocated += allocatedAmount;
    totalSpent += spentAmount;
    totalRemaining += remainingAmount;

    // Increment counts
    totalCount++;

    // Check if over or under budget
    if (spentAmount > allocatedAmount) {
      overBudgetCount++;
    } else if (spentAmount < allocatedAmount) {
      underBudgetCount++;
    }

    // Build detailed entry if requested (now always true)
    if (includeEntries) {
      // Calculate checklist completion
      const checklistItemsCount = budgetPeriod.checklistItems?.length || 0;
      const checklistItemsCompleted =
        budgetPeriod.checklistItems?.filter((item) => item.isChecked).length ||
        0;
      const checklistProgressPercentage =
        checklistItemsCount > 0
          ? Math.round((checklistItemsCompleted / checklistItemsCount) * 100)
          : 0;

      // Calculate progress percentage
      const progressPercentage =
        allocatedAmount > 0
          ? Math.round((spentAmount / allocatedAmount) * 100)
          : 0;

      // Check if over budget
      const isOverBudget = spentAmount > allocatedAmount;
      const overageAmount = isOverBudget ? spentAmount - allocatedAmount : undefined;

      const entry: BudgetEntry = {
        // === IDENTITY ===
        budgetId: budgetPeriod.budgetId,
        budgetPeriodId: budgetPeriod.id || "",
        budgetName: budgetPeriod.budgetName || "Unnamed Budget",
        categoryId: "uncategorized", // TODO: Fetch from parent budget document

        // === AMOUNTS ===
        totalAllocated: allocatedAmount,
        totalSpent: spentAmount,
        totalRemaining: remainingAmount,
        averageBudget: allocatedAmount, // TODO: Fetch from parent budget for true average

        // === PROGRESS METRICS ===
        progressPercentage,
        checklistItemsCount:
          checklistItemsCount > 0 ? checklistItemsCount : undefined,
        checklistItemsCompleted:
          checklistItemsCount > 0 ? checklistItemsCompleted : undefined,
        checklistProgressPercentage:
          checklistItemsCount > 0 ? checklistProgressPercentage : undefined,

        // === STATUS ===
        isOverBudget,
        overageAmount,

        // === GROUPING ===
        groupId: budgetPeriod.groupIds?.[0] || "", // First group ID or empty string
      };
      entries.push(entry);
    }
  }

  const summary: BudgetSummaryData = {
    totalAllocated,
    totalSpent,
    totalRemaining,
    totalCount,
    overBudgetCount,
    underBudgetCount,
  };

  // Add entries if requested
  if (includeEntries) {
    summary.entries = entries;
  }

  console.log(`[calculateBudgetSummary] Summary calculated:`, {
    totalAllocated,
    totalSpent,
    totalRemaining,
    totalCount,
    overBudgetCount,
    underBudgetCount,
    entriesCount: entries.length,
  });

  return summary;
}
