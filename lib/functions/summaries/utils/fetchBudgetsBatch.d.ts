import { BudgetPeriodDocument } from "../../../types";
/**
 * Fetches all budget periods for a user in a specific source period and period type
 *
 * This function queries the budget_periods collection to retrieve all
 * budget periods that belong to a specific user, source period, and period type.
 * This ensures that only budgets matching the viewed period type are included.
 *
 * @param userId - The user ID
 * @param sourcePeriodId - The period ID (e.g., "2025-M11")
 * @param periodType - The period type (e.g., "MONTHLY", "BI_MONTHLY", "WEEKLY")
 * @returns Array of BudgetPeriodDocument documents
 */
export declare function fetchBudgetsBatch(userId: string, sourcePeriodId: string, periodType: string): Promise<BudgetPeriodDocument[]>;
//# sourceMappingURL=fetchBudgetsBatch.d.ts.map