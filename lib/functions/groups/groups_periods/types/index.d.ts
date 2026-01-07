/**
 * Groups Periods Types
 *
 * Type definitions for period-based group tracking
 */
/**
 * Group Period Document
 *
 * Tracks group activity and metrics for a specific time period.
 * Lives at: /group_periods/{groupId}/periods/{periodId}
 */
export interface GroupPeriod {
    groupId: string;
    periodId: string;
    periodType: 'weekly' | 'bi_monthly' | 'monthly' | 'annual';
    periodStartDate: FirebaseFirestore.Timestamp;
    periodEndDate: FirebaseFirestore.Timestamp;
    isCurrent: boolean;
    metrics: GroupPeriodMetrics;
    activeMemberIds: string[];
    createdAt: FirebaseFirestore.Timestamp;
    updatedAt: FirebaseFirestore.Timestamp;
}
/**
 * Group Period Metrics
 */
export interface GroupPeriodMetrics {
    totalOutflows: number;
    totalInflows: number;
    totalTransactions: number;
    totalBudgets: number;
    totalOutflowAmount: number;
    totalInflowAmount: number;
    totalTransactionAmount: number;
    resourcesShared: number;
    resourcesModified: number;
    activeMemberCount: number;
    contributingMemberCount: number;
}
//# sourceMappingURL=index.d.ts.map