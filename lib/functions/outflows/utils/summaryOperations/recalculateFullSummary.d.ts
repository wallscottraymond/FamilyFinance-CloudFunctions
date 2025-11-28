import { PeriodType, OutflowPeriodEntry } from "../../../../types";
/**
 * Recalculate the entire outflow summary from scratch
 *
 * This function is used for:
 * - Initial summary creation
 * - Full data backfill/migration
 * - Debugging and verification
 * - Recovery from data inconsistencies
 *
 * Process:
 * 1. Query all active outflow_periods in 2-year window
 * 2. Extract unique sourcePeriodIds
 * 3. Call recalculatePeriodGroup() for each sourcePeriodId
 * 4. Build complete periods object grouped by sourcePeriodId
 *
 * @param params - Calculation parameters
 * @returns Complete periods object ready for summary document
 */
export declare function recalculateFullSummary(params: {
    ownerId: string;
    ownerType: 'user' | 'group';
    periodType: PeriodType;
}): Promise<{
    periods: {
        [sourcePeriodId: string]: OutflowPeriodEntry[];
    };
    totalItemCount: number;
}>;
/**
 * Helper function to format summary ID
 */
export declare function buildSummaryId(ownerId: string, ownerType: 'user' | 'group', periodType: PeriodType): string;
//# sourceMappingURL=recalculateFullSummary.d.ts.map