/**
 * Assign Split to All Outflow Periods - Callable Cloud Function
 *
 * Assigns a transaction split to ALL THREE outflow period types (monthly, weekly, bi-weekly)
 * simultaneously to maintain consistency across all period views in the app.
 *
 * CRITICAL: This is the ONLY supported method for assigning splits to outflows.
 * Always assigns to all three period types to keep views synchronized.
 *
 * PARAMETERS:
 * - transactionId: Transaction containing the split
 * - splitId: Specific split to assign
 * - outflowId: Parent outflow ID (not period ID!)
 * - paymentType: 'regular' | 'catch_up' | 'advance' | 'extra_principal'
 * - clearBudgetAssignment: Clear budget fields when moving to outflow
 * - targetPeriodId: Optional specific period for advance payments
 *
 * MATCHING MODES:
 * 1. Auto-detect (default): Uses transaction date to find matching periods
 * 2. Manual target: Uses targetPeriodId for advance payments across multiple periods
 *
 * RETURNS:
 * - success: boolean
 * - split: Updated transaction split with all period references
 * - monthlyPeriod, weeklyPeriod, biWeeklyPeriod: Updated period documents
 * - periodsUpdated: Count of periods updated (up to 3)
 *
 * PAYMENT TYPES:
 * - REGULAR: Normal on-time payment
 * - CATCH_UP: Payment for past-due bill
 * - ADVANCE: Payment > 7 days before due date
 * - EXTRA_PRINCIPAL: Payment exceeding required amount
 *
 * SECURITY:
 * - Requires EDITOR role or higher
 * - User must own transaction and outflow
 * - Cannot reassign split already assigned to another outflow
 *
 * See CLAUDE.md for detailed workflow examples and data architecture.
 */
import { OutflowPeriod, TransactionSplit } from '../../../../types';
/**
 * Request to assign a split to all outflow periods
 */
export interface AssignSplitToAllOutflowPeriodsRequest {
    transactionId: string;
    splitId: string;
    outflowId: string;
    paymentType?: 'regular' | 'catch_up' | 'advance' | 'extra_principal';
    clearBudgetAssignment?: boolean;
    targetPeriodId?: string;
}
/**
 * Response from assigning a split to all periods
 */
export interface AssignSplitToAllOutflowPeriodsResponse {
    success: boolean;
    split?: TransactionSplit;
    monthlyPeriod?: OutflowPeriod;
    weeklyPeriod?: OutflowPeriod;
    biWeeklyPeriod?: OutflowPeriod;
    periodsUpdated: number;
    message?: string;
}
/**
 * Callable function to assign a transaction split to ALL outflow periods
 */
export declare const assignSplitToAllOutflowPeriods: import("firebase-functions/v2/https").CallableFunction<any, Promise<AssignSplitToAllOutflowPeriodsResponse>>;
//# sourceMappingURL=assignSplitToAllOutflowPeriods.d.ts.map