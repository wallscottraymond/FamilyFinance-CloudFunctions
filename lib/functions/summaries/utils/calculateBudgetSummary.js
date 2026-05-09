"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateBudgetSummary = calculateBudgetSummary;
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
function calculateBudgetSummary(budgetPeriods) {
    console.log(`[calculateBudgetSummary] Converting ${budgetPeriods.length} budget periods to entries`);
    // Build entries array directly (one entry per period)
    const entries = budgetPeriods.map(budgetPeriod => {
        var _a, _b, _c;
        // Use modified amount if available, otherwise use allocated amount
        const allocatedAmount = budgetPeriod.modifiedAmount || budgetPeriod.allocatedAmount;
        // Use actual spent amount from budget period (calculated by updateBudgetSpending)
        const spentAmount = budgetPeriod.spent || 0;
        // Get rollover amount (can be positive for surplus or negative for deficit)
        const rolledOverAmount = budgetPeriod.rolledOverAmount || 0;
        const hasRollover = rolledOverAmount !== 0;
        // Effective amount is what the user actually has available (allocated + rollover)
        const effectiveAmount = allocatedAmount + rolledOverAmount;
        // Remaining includes rollover: effective - spent
        // This allows negative remaining when rollover deficit exceeds spending capacity
        const remainingAmount = effectiveAmount - spentAmount;
        // Calculate checklist completion
        const checklistItemsCount = ((_a = budgetPeriod.checklistItems) === null || _a === void 0 ? void 0 : _a.length) || 0;
        const checklistItemsCompleted = ((_b = budgetPeriod.checklistItems) === null || _b === void 0 ? void 0 : _b.filter((item) => item.isChecked).length) ||
            0;
        const checklistProgressPercentage = checklistItemsCount > 0
            ? Math.round((checklistItemsCompleted / checklistItemsCount) * 100)
            : 0;
        // Extract user notes
        const userNotes = budgetPeriod.userNotes;
        // Calculate progress percentage based on effective amount (includes rollover)
        // Use effectiveAmount for accurate progress when rollover is present
        const progressPercentage = effectiveAmount > 0
            ? Math.round((spentAmount / effectiveAmount) * 100)
            : effectiveAmount < 0
                ? 100 // Already over due to negative rollover
                : 0;
        // Check if over budget (comparing against effective amount)
        const isOverBudget = spentAmount > effectiveAmount;
        const overageAmount = isOverBudget ? spentAmount - effectiveAmount : undefined;
        return {
            // === IDENTITY ===
            budgetId: budgetPeriod.budgetId,
            budgetPeriodId: budgetPeriod.id || "",
            budgetName: budgetPeriod.budgetName || "Unnamed Budget",
            categoryId: "uncategorized", // TODO: Fetch from parent budget document
            // === AMOUNTS ===
            maxAmount: allocatedAmount, // Clearer field name
            totalAllocated: allocatedAmount, // Backward compatibility
            totalSpent: spentAmount, // Now uses actual data
            totalRemaining: remainingAmount, // Now includes rollover
            averageBudget: allocatedAmount, // TODO: Fetch from parent budget for true average
            // === ROLLOVER ===
            rolledOverAmount: hasRollover ? rolledOverAmount : undefined,
            effectiveAmount: hasRollover ? effectiveAmount : undefined,
            hasRollover: hasRollover || undefined,
            // === USER INPUT ===
            userNotes, // User notes from period
            // === PROGRESS METRICS ===
            progressPercentage,
            checklistItemsCount: checklistItemsCount > 0 ? checklistItemsCount : undefined,
            checklistItemsCompleted: checklistItemsCount > 0 ? checklistItemsCompleted : undefined,
            checklistProgressPercentage: checklistItemsCount > 0 ? checklistProgressPercentage : undefined,
            // === STATUS ===
            isOverBudget,
            overageAmount,
            // === GROUPING ===
            groupId: ((_c = budgetPeriod.groupIds) === null || _c === void 0 ? void 0 : _c[0]) || "", // First group ID or empty string
        };
    });
    console.log(`[calculateBudgetSummary] Converted ${entries.length} entries`);
    return entries;
}
//# sourceMappingURL=calculateBudgetSummary.js.map