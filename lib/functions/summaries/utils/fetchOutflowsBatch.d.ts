import { OutflowPeriod } from "../../../types";
/**
 * Fetches all outflow periods for a user in a specific source period
 *
 * This function queries the outflow_periods collection to retrieve all
 * outflow periods that belong to a specific user and source period.
 *
 * @param userId - The user ID
 * @param sourcePeriodId - The period ID (e.g., "2025-M11")
 * @returns Array of OutflowPeriod documents
 */
export declare function fetchOutflowsBatch(userId: string, sourcePeriodId: string): Promise<OutflowPeriod[]>;
//# sourceMappingURL=fetchOutflowsBatch.d.ts.map