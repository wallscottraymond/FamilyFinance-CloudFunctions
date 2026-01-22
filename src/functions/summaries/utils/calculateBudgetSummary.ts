import { BudgetPeriodDocument } from "../../../types";
import { BudgetEntry } from "../types/periodSummaries";

/**
 * Calculates budget entries from budget periods
 *
 * Converts budget periods into an array of budget entries for frontend display.
 * Spending amounts are read from budget_period.spent, which is calculated by
 * updateBudgetSpending() when transactions are created/updated/deleted.
 *
 * @param budgetPeriods - Array of budget periods to convert
 * @returns Array of BudgetEntry objects
 */
export function calculateBudgetSummary(
  budgetPeriods: BudgetPeriodDocument[]
): BudgetEntry[] {
  console.log(
    `[calculateBudgetSummary] Converting ${budgetPeriods.length} budget periods to entries`
  );

  // Build entries array directly (one entry per period)
  const entries: BudgetEntry[] = budgetPeriods.map(budgetPeriod => {
    // Use modified amount if available, otherwise use allocated amount
    const allocatedAmount =
      budgetPeriod.modifiedAmount || budgetPeriod.allocatedAmount;

    // Use actual spent amount from budget period (calculated by updateBudgetSpending)
    const spentAmount = budgetPeriod.spent || 0;

    const remainingAmount = allocatedAmount - spentAmount;

    // Calculate checklist completion
    const checklistItemsCount = budgetPeriod.checklistItems?.length || 0;
    const checklistItemsCompleted =
      budgetPeriod.checklistItems?.filter((item) => item.isChecked).length ||
      0;
    const checklistProgressPercentage =
      checklistItemsCount > 0
        ? Math.round((checklistItemsCompleted / checklistItemsCount) * 100)
        : 0;

    // Extract user notes
    const userNotes = budgetPeriod.userNotes;

    // Calculate progress percentage
    const progressPercentage =
      allocatedAmount > 0
        ? Math.round((spentAmount / allocatedAmount) * 100)
        : 0;

    // Check if over budget
    const isOverBudget = spentAmount > allocatedAmount;
    const overageAmount = isOverBudget ? spentAmount - allocatedAmount : undefined;

    return {
      // === IDENTITY ===
      budgetId: budgetPeriod.budgetId,
      budgetPeriodId: budgetPeriod.id || "",
      budgetName: budgetPeriod.budgetName || "Unnamed Budget",
      categoryId: "uncategorized", // TODO: Fetch from parent budget document

      // === AMOUNTS ===
      maxAmount: allocatedAmount,           // Clearer field name
      totalAllocated: allocatedAmount,      // Backward compatibility
      totalSpent: spentAmount,              // Now uses actual data
      totalRemaining: remainingAmount,
      averageBudget: allocatedAmount,       // TODO: Fetch from parent budget for true average

      // === USER INPUT ===
      userNotes,                            // User notes from period

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
  });

  console.log(`[calculateBudgetSummary] Converted ${entries.length} entries`);

  return entries;
}
