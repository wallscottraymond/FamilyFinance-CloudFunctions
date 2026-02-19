/**
 * Calculate Inflow Period Status Utility
 *
 * Determines the status of an inflow period based on:
 * - Whether period has income due
 * - How many occurrences have been received
 * - Due dates vs current date
 *
 * Status Priority (highest to lowest):
 * 1. NOT_EXPECTED - No income expected this period
 * 2. RECEIVED - All occurrences received
 * 3. PARTIAL - Some occurrences received
 * 4. OVERDUE - Expected date passed, not received
 * 5. PENDING - Expecting income, not yet received
 */
import { Timestamp } from 'firebase-admin/firestore';
import { InflowPeriod } from '../../../../types';
/**
 * Inflow period status enum
 */
export declare enum InflowPeriodStatus {
    RECEIVED = "received",// All occurrences received
    PARTIAL = "partial",// Some occurrences received
    PENDING = "pending",// Expecting income, not yet received
    OVERDUE = "overdue",// Expected date passed, not received
    NOT_EXPECTED = "not_expected"
}
/**
 * Status calculation result
 */
export interface StatusResult {
    status: InflowPeriodStatus;
    isFullyPaid: boolean;
    isPartiallyPaid: boolean;
    isOverdue: boolean;
    daysPastDue: number | null;
    nextDueDate: Timestamp | null;
}
/**
 * Calculate the status of an inflow period
 *
 * Uses occurrence tracking to determine accurate status.
 * Falls back to amount-based calculation if occurrences aren't tracked.
 *
 * @param inflowPeriod - The inflow period to calculate status for
 * @param referenceDate - The date to compare against (default: now)
 * @returns InflowPeriodStatus enum value
 *
 * @example
 * ```typescript
 * // Period with 2 occurrences, 1 received
 * const status = calculateInflowPeriodStatus(inflowPeriod);
 * // InflowPeriodStatus.PARTIAL
 *
 * // Period with all occurrences received
 * const status = calculateInflowPeriodStatus(inflowPeriod);
 * // InflowPeriodStatus.RECEIVED
 *
 * // Period with no income expected
 * const status = calculateInflowPeriodStatus(inflowPeriod);
 * // InflowPeriodStatus.NOT_EXPECTED
 * ```
 */
export declare function calculateInflowPeriodStatus(inflowPeriod: Partial<InflowPeriod>, referenceDate?: Date): InflowPeriodStatus;
/**
 * Get status display properties
 *
 * Returns user-friendly display properties for a status.
 *
 * @param status - The inflow period status
 * @returns Display properties (label, color, icon)
 */
export declare function getStatusDisplayProperties(status: InflowPeriodStatus): {
    label: string;
    color: string;
    icon: string;
};
export default calculateInflowPeriodStatus;
//# sourceMappingURL=calculateInflowPeriodStatus.d.ts.map