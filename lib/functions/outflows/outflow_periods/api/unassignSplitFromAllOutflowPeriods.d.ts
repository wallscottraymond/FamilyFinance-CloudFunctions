/**
 * Unassign Split from All Outflow Periods - Callable Function
 *
 * Removes a transaction split assignment from ALL THREE outflow period types
 * (monthly, weekly, bi-weekly) simultaneously. This ensures that when a user
 * removes a bill payment assignment, all period views are updated correctly.
 *
 * Key Features:
 * - Extracts all three period IDs from the transaction split
 * - Clears all outflow references from the split
 * - Removes payment reference from all three outflow_periods documents
 * - Recalculates status for all three periods
 * - Atomic batch operations for data consistency
 *
 * Memory: 256MiB, Timeout: 30s
 */
import { OutflowPeriod } from '../../../../types';
/**
 * Request to unassign a split from all outflow periods
 */
export interface UnassignSplitFromAllOutflowPeriodsRequest {
    transactionId: string;
    splitId: string;
}
/**
 * Response from unassigning a split from all periods
 */
export interface UnassignSplitFromAllOutflowPeriodsResponse {
    success: boolean;
    monthlyPeriod?: OutflowPeriod;
    weeklyPeriod?: OutflowPeriod;
    biWeeklyPeriod?: OutflowPeriod;
    periodsUpdated: number;
    message?: string;
}
/**
 * Callable function to unassign a transaction split from ALL outflow periods
 */
export declare const unassignSplitFromAllOutflowPeriods: import("firebase-functions/v2/https").CallableFunction<any, Promise<UnassignSplitFromAllOutflowPeriodsResponse>>;
//# sourceMappingURL=unassignSplitFromAllOutflowPeriods.d.ts.map