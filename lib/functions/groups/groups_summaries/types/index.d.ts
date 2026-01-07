/**
 * Groups Summaries Types
 *
 * Type definitions for group-level summary documents
 */
/**
 * Group Outflow Summary Document
 *
 * Aggregated summary of all outflows shared with a group.
 * Lives at: /group_summaries/{groupId}/outflow_summaries/{summaryId}
 */
export interface GroupOutflowSummary {
    groupId: string;
    summaryId: string;
    periodType: 'weekly' | 'bi_monthly' | 'monthly' | 'annual';
    periodStartDate: FirebaseFirestore.Timestamp;
    periodEndDate: FirebaseFirestore.Timestamp;
    totalOutflows: number;
    totalAmount: number;
    totalPaid: number;
    totalUnpaid: number;
    byExpenseType: {
        [key: string]: {
            count: number;
            total: number;
            paid: number;
            unpaid: number;
        };
    };
    outflows: GroupOutflowEntry[];
    lastUpdated: FirebaseFirestore.Timestamp;
    contributingUserIds: string[];
}
/**
 * Individual outflow entry in group summary
 */
export interface GroupOutflowEntry {
    outflowId: string;
    userId: string;
    merchant: string;
    averageAmount: number;
    totalAmountDue: number;
    totalAmountPaid: number;
    totalAmountUnpaid: number;
    periodId: string;
    isDuePeriod: boolean;
    isCurrent: boolean;
    itemCount: number;
    fullyPaidCount: number;
    nextUnpaidDueDate?: FirebaseFirestore.Timestamp;
}
/**
 * Group Inflow Summary Document
 *
 * Aggregated summary of all inflows shared with a group.
 * Lives at: /group_summaries/{groupId}/inflow_summaries/{summaryId}
 */
export interface GroupInflowSummary {
    groupId: string;
    summaryId: string;
    periodType: 'weekly' | 'bi_monthly' | 'monthly' | 'annual';
    periodStartDate: FirebaseFirestore.Timestamp;
    periodEndDate: FirebaseFirestore.Timestamp;
    totalInflows: number;
    totalAmount: number;
    totalReceived: number;
    totalPending: number;
    byIncomeType: {
        [key: string]: {
            count: number;
            total: number;
            received: number;
            pending: number;
        };
    };
    inflows: GroupInflowEntry[];
    lastUpdated: FirebaseFirestore.Timestamp;
    contributingUserIds: string[];
}
/**
 * Individual inflow entry in group summary
 */
export interface GroupInflowEntry {
    inflowId: string;
    userId: string;
    description: string;
    averageAmount: number;
    totalAmountExpected: number;
    totalAmountReceived: number;
    totalAmountPending: number;
    periodId: string;
    isExpectedPeriod: boolean;
    isCurrent: boolean;
    nextExpectedDate?: FirebaseFirestore.Timestamp;
}
//# sourceMappingURL=index.d.ts.map