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
export declare function calculateBudgetSummary(budgetPeriods: BudgetPeriodDocument[]): BudgetEntry[];
//# sourceMappingURL=calculateBudgetSummary.d.ts.map