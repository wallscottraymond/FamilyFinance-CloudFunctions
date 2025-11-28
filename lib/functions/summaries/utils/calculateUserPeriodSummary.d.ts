import { UserPeriodSummary } from "../../../types/periodSummaries";
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
export declare function calculateUserPeriodSummary(userId: string, periodType: string, sourcePeriodId: string, includeEntries?: boolean): Promise<UserPeriodSummary>;
//# sourceMappingURL=calculateUserPeriodSummary.d.ts.map