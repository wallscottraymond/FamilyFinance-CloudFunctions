import { BudgetPeriodDocument } from "../../../types";
import { BudgetEntry } from "../../../types/periodSummaries";
/**
 * Calculates budget entries from budget periods
 *
 * Converts budget periods into an array of budget entries for frontend display.
 * Frontend calculates aggregated totals on-the-fly for better performance.
 *
 * NOTE: Currently, spentAmount is set to 0 as a placeholder.
 * In a future enhancement, this should be calculated by:
 * 1. Querying transactions linked to each budget
 * 2. Summing transaction amounts that fall within the period
 * 3. Calculating actual spending against allocated amounts
 *
 * @param budgetPeriods - Array of budget periods to convert
 * @returns Array of BudgetEntry objects
 */
export declare function calculateBudgetSummary(budgetPeriods: BudgetPeriodDocument[]): BudgetEntry[];
//# sourceMappingURL=calculateBudgetSummary.d.ts.map