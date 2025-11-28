import { InflowPeriod } from "../../../types";
/**
 * Fetches all inflow periods for a user in a specific source period
 *
 * This function queries the inflow_periods collection to retrieve all
 * inflow periods that belong to a specific user and source period.
 *
 * @param userId - The user ID
 * @param sourcePeriodId - The period ID (e.g., "2025-M11")
 * @returns Array of InflowPeriod documents
 */
export declare function fetchInflowsBatch(userId: string, sourcePeriodId: string): Promise<InflowPeriod[]>;
//# sourceMappingURL=fetchInflowsBatch.d.ts.map