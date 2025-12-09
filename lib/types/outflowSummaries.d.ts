import { Timestamp } from "firebase-admin/firestore";
import { PeriodType } from "./index";
/**
 * Single outflow period's aggregated summary data
 * NOTE: sourcePeriodId is the object key in parent structure (e.g., "2025-M11")
 * NOTE: periodStartDate/periodEndDate removed - derivable from sourcePeriodId
 */
export interface OutflowPeriodEntry {
    periodId: string;
    outflowId: string;
    groupId: string;
    merchant: string;
    userCustomName: string;
    totalAmountDue: number;
    totalAmountPaid: number;
    totalAmountUnpaid: number;
    totalAmountWithheld: number;
    averageAmount: number;
    isDuePeriod: boolean;
    duePeriodCount: number;
    statusCounts: OutflowStatusCounts;
    paymentProgressPercentage: number;
    fullyPaidCount: number;
    unpaidCount: number;
    itemCount: number;
    hasOccurrenceTracking: boolean;
    numberOfOccurrences: number;
    numberOfOccurrencesPaid: number;
    numberOfOccurrencesUnpaid: number;
    occurrencePaymentPercentage: number;
    occurrenceStatusText: string | null;
}
export interface OutflowStatusCounts {
    PAID?: number;
    OVERDUE?: number;
    DUE_SOON?: number;
    PENDING?: number;
    PARTIAL?: number;
    NOT_DUE?: number;
}
/**
 * Outflow period summary document structure
 * Periods are organized as nested object for O(1) lookup by period ID
 */
export interface OutflowPeriodSummary {
    ownerId: string;
    ownerType: 'user' | 'group';
    periodType: PeriodType;
    resourceType: 'outflow';
    windowStart: Timestamp;
    windowEnd: Timestamp;
    periods: {
        [sourcePeriodId: string]: OutflowPeriodEntry[];
    };
    totalItemCount: number;
    lastRecalculated: Timestamp;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    totalPaidOccurrences: number;
    totalUnpaidOccurrences: number;
    totalOccurrences: number;
}
//# sourceMappingURL=outflowSummaries.d.ts.map