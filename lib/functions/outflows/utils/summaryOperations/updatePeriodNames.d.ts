import { OutflowPeriodEntry } from "../../../../types";
/**
 * Update merchant and userCustomName for all entries of a specific outflow
 *
 * This function is called when:
 * - outflow.merchantName changes
 * - outflow.userCustomName changes
 * - outflow.description changes (fallback for merchant)
 *
 * It updates the denormalized merchant/userCustomName fields across all
 * period entries for the given outflow, preserving all other data.
 *
 * @param params - Update parameters
 * @returns Updated periods object ready for batch write
 */
export declare function updatePeriodNames(params: {
    currentPeriods: {
        [sourcePeriodId: string]: OutflowPeriodEntry[];
    };
    outflowId: string;
    merchant: string;
    userCustomName: string;
}): {
    [sourcePeriodId: string]: OutflowPeriodEntry[];
};
//# sourceMappingURL=updatePeriodNames.d.ts.map