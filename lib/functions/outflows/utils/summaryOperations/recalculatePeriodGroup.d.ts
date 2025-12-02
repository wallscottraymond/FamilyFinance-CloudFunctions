import { OutflowPeriodEntry, PeriodType } from "../../../../types";
/**
 * Recalculate all outflow period entries for a specific sourcePeriodId
 *
 * This function:
 * 1. Queries all outflow_periods with the given sourcePeriodId
 * 2. Creates ONE OutflowPeriodEntry for EACH outflow_period
 * 3. Fetches parent outflow data for merchant/userCustomName
 * 4. Returns array of OutflowPeriodEntry objects ready for batch write
 *
 * NOTE: No aggregation! Each outflow_period maps to exactly one entry.
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