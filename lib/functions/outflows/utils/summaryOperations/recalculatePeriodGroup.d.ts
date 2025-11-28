import { OutflowPeriodEntry, PeriodType } from "../../../../types";
/**
 * Recalculate all outflow period entries for a specific sourcePeriodId
 *
 * This is the core aggregation function that:
 * 1. Queries all outflow_periods with the given sourcePeriodId
 * 2. Groups them by outflowId (multiple periods can exist for same outflow)
 * 3. Fetches parent outflow data for merchant/userCustomName
 * 4. Aggregates amounts, statuses, and metrics across all periods
 * 5. Returns array of OutflowPeriodEntry objects ready for batch write
 *
 * @param params - Calculation parameters
 * @returns Array of OutflowPeriodEntry objects for the period group
 */
export declare function recalculatePeriodGroup(params: {
    ownerId: string;
    ownerType: 'user' | 'group';
    periodType: PeriodType;
    sourcePeriodId: string;
}): Promise<OutflowPeriodEntry[]>;
//# sourceMappingURL=recalculatePeriodGroup.d.ts.map