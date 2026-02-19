import { Timestamp } from "firebase-admin/firestore";
import { PeriodType, OutflowPeriodStatus } from "../../../types";
/**
 * Period-Centric Summary System Types
 *
 * This module defines types for the period-centric summary architecture where
 * each period (e.g., "2025-M11") has a single summary document containing ALL
 * resources: outflows, budgets, inflows, and goals.
 *
 * Key Concepts:
 * - User Summaries: User-specific period aggregations
 * - Group Summaries: Group-specific period aggregations
 * - Resource Summary Data: Outflows, Budgets, Inflows, Goals
 * - Cross-Resource Metrics: Net cash flow, savings rate, etc.
 */
/**
 * Helper type for resource types in the system
 */
export type ResourceType = 'outflow' | 'budget' | 'inflow' | 'goal';
/**
 * Outflow-specific summary data for a period
 * Aggregates all outflow_periods for a specific user/group/period
 */
export interface OutflowSummaryData {
    totalAmountDue: number;
    totalAmountPaid: number;
    totalAmountWithheld: number;
    totalCount: number;
    duePeriodCount: number;
    fullyPaidCount: number;
    unpaidCount: number;
    statusCounts: {
        PAID?: number;
        OVERDUE?: number;
        DUE_SOON?: number;
        PENDING?: number;
        PARTIAL?: number;
        NOT_DUE?: number;
    };
    entries?: OutflowEntry[];
}
/**
 * Individual outflow entry for detailed view
 * Enhanced to include all fields for frontend tile rendering
 */
export interface OutflowEntry {
    outflowId: string;
    outflowPeriodId: string;
    description: string;
    merchant: string;
    userCustomName?: string;
    totalAmountDue: number;
    totalAmountPaid: number;
    totalAmountUnpaid: number;
    totalAmountWithheld: number;
    averageAmount: number;
    isDuePeriod: boolean;
    duePeriodCount: number;
    dueDate?: Timestamp;
    status: OutflowPeriodStatus;
    paymentProgressPercentage: number;
    fullyPaidCount: number;
    unpaidCount: number;
    itemCount: number;
    groupId: string;
}
/**
 * Budget-specific summary data for a period
 * Aggregates all budget_periods for a specific user/group/period
 */
export interface BudgetSummaryData {
    totalAllocated: number;
    totalSpent: number;
    totalRemaining: number;
    totalCount: number;
    overBudgetCount: number;
    underBudgetCount: number;
    entries?: BudgetEntry[];
}
/**
 * Individual budget entry for detailed view
 * Enhanced to include all fields for frontend tile rendering
 */
export interface BudgetEntry {
    budgetId: string;
    budgetPeriodId: string;
    budgetName: string;
    categoryId: string;
    maxAmount: number;
    totalAllocated: number;
    totalSpent: number;
    totalRemaining: number;
    averageBudget: number;
    userNotes?: string;
    progressPercentage: number;
    checklistItemsCount?: number;
    checklistItemsCompleted?: number;
    checklistProgressPercentage?: number;
    isOverBudget: boolean;
    overageAmount?: number;
    groupId: string;
}
/**
 * Inflow-specific summary data for a period
 * Aggregates all inflow_periods for a specific user/group/period
 */
export interface InflowSummaryData {
    totalExpectedIncome: number;
    totalReceivedIncome: number;
    totalPendingIncome: number;
    totalCount: number;
    receiptPeriodCount: number;
    fullyReceivedCount: number;
    pendingCount: number;
    entries?: InflowEntry[];
}
/**
 * Payment prediction for an inflow
 */
export interface InflowPaymentPrediction {
    expectedDate: Timestamp;
    expectedAmount: number;
    confidenceLevel: 'high' | 'medium' | 'low';
    predictionMethod: 'plaid' | 'frequency' | 'rolling_average' | 'user_override';
    daysUntilPayment: number;
}
/**
 * Individual inflow entry for detailed view
 * Enhanced to include all fields for frontend tile rendering
 */
export interface InflowEntry {
    inflowId: string;
    inflowPeriodId: string;
    description: string;
    source: string;
    userCustomName?: string;
    totalExpected: number;
    totalReceived: number;
    totalPending: number;
    averageAmount: number;
    amountPerOccurrence: number;
    isReceiptPeriod: boolean;
    expectedDate?: Timestamp;
    isRegularSalary: boolean;
    receiptProgressPercentage: number;
    dollarProgressPercentage: number;
    isFullyReceived: boolean;
    isPending: boolean;
    occurrenceCount: number;
    occurrencesPaid: number;
    occurrenceDueDates: Timestamp[];
    firstDueDateInPeriod?: Timestamp;
    lastDueDateInPeriod?: Timestamp;
    nextUnpaidDueDate?: Timestamp;
    nextPaymentPrediction?: InflowPaymentPrediction;
    groupId: string;
    incomeType: string;
}
/**
 * Goal-specific summary data for a period
 * Aggregates all goal_periods for a specific user/group/period
 *
 * NOTE: Goals are not yet implemented, this is a placeholder
 */
export interface GoalSummaryData {
    totalTargetAmount: number;
    totalSavedAmount: number;
    totalRemainingAmount: number;
    totalCount: number;
    onTrackCount: number;
    behindCount: number;
    completedCount: number;
    entries?: GoalEntry[];
}
/**
 * Individual goal entry for detailed view
 */
export interface GoalEntry {
    goalId: string;
    goalName: string;
    targetAmount: number;
    savedAmount: number;
    remainingAmount: number;
    targetDate: Timestamp;
    progressPercentage: number;
    isOnTrack: boolean;
}
/**
 * User Period Summary Document
 *
 * Single document containing all financial data for a specific user and period.
 * Document ID Format: {userId}_{periodType}_{sourcePeriodId}
 *
 * Examples:
 * - user123_monthly_2025-M11
 * - user123_weekly_2025-W45
 * - user123_bimonthly_2025-BM11-A
 */
export interface UserPeriodSummary {
    id: string;
    userId: string;
    sourcePeriodId: string;
    periodType: PeriodType;
    periodStartDate: Timestamp;
    periodEndDate: Timestamp;
    year: number;
    month?: number;
    weekNumber?: number;
    outflows: OutflowEntry[];
    budgets: BudgetEntry[];
    inflows: InflowEntry[];
    goals: GoalEntry[];
    lastRecalculated: Timestamp;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}
/**
 * Group Period Summary Document
 *
 * Single document containing all financial data for a specific group and period.
 * Document ID Format: {groupId}_{periodType}_{sourcePeriodId}
 *
 * Examples:
 * - group456_monthly_2025-M11
 * - group456_weekly_2025-W45
 */
export interface GroupPeriodSummary {
    id: string;
    groupId: string;
    sourcePeriodId: string;
    periodType: PeriodType;
    periodStartDate: Timestamp;
    periodEndDate: Timestamp;
    year: number;
    month?: number;
    weekNumber?: number;
    outflows: OutflowSummaryData;
    budgets: BudgetSummaryData;
    inflows: InflowSummaryData;
    goals: GoalSummaryData;
    totalIncome: number;
    totalExpenses: number;
    netCashFlow: number;
    savingsRate: number;
    memberContributions: {
        [userId: string]: {
            income: number;
            expenses: number;
            netContribution: number;
        };
    };
    lastRecalculated: Timestamp;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}
//# sourceMappingURL=periodSummaries.d.ts.map