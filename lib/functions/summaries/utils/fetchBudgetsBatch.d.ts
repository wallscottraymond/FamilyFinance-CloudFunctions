import { BudgetPeriodDocument } from "../../../types";
/**
 * Fetches all budget periods for a user in a specific source period
 *
 * This function queries the budget_periods collection to retrieve all
 * budget periods that belong to a specific user and source period.
 *
 * @param userId - The user ID
 * @param sourcePeriodId - The period ID (e.g., "2025-M11")
 * @returns Array of BudgetPeriodDocument documents
 */
export declare function fetchBudgetsBatch(userId: string, sourcePeriodId: string): Promise<BudgetPeriodDocument[]>;
//# sourceMappingURL=fetchBudgetsBatch.d.ts.map