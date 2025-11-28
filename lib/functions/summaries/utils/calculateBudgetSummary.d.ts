import { BudgetPeriodDocument } from "../../../types";
import { BudgetSummaryData } from "../../../types/periodSummaries";
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
export declare function calculateBudgetSummary(budgetPeriods: BudgetPeriodDocument[], includeEntries?: boolean): BudgetSummaryData;
//# sourceMappingURL=calculateBudgetSummary.d.ts.map