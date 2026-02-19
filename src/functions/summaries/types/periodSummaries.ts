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

// ============================================================================
// RESOURCE TYPE
// ============================================================================

/**
 * Helper type for resource types in the system
 */
export type ResourceType = 'outflow' | 'budget' | 'inflow' | 'goal';

// ============================================================================
// OUTFLOW SUMMARY DATA
// ============================================================================

/**
 * Outflow-specific summary data for a period
 * Aggregates all outflow_periods for a specific user/group/period
 */
export interface OutflowSummaryData {
  // === TOTALS ===
  totalAmountDue: number;          // All bills due this period
  totalAmountPaid: number;         // All bills paid this period
  totalAmountWithheld: number;     // Amount to set aside this period

  // === COUNTS ===
  totalCount: number;              // Total outflows with periods
  duePeriodCount: number;          // How many bills are due
  fullyPaidCount: number;          // How many fully paid
  unpaidCount: number;             // How many unpaid

  // === STATUS BREAKDOWN ===
  statusCounts: {
    PAID?: number;
    OVERDUE?: number;
    DUE_SOON?: number;
    PENDING?: number;
    PARTIAL?: number;
    NOT_DUE?: number;
  };

  // === DETAILED ENTRIES (Optional - for expanded view) ===
  entries?: OutflowEntry[];        // Individual outflow details
}

/**
 * Individual outflow entry for detailed view
 * Enhanced to include all fields for frontend tile rendering
 */
export interface OutflowEntry {
  // === IDENTITY ===
  outflowId: string;
  outflowPeriodId: string;
  description: string;
  merchant: string;
  userCustomName?: string;

  // === AMOUNTS ===
  totalAmountDue: number;          // Total amount due this period
  totalAmountPaid: number;         // Total amount paid this period
  totalAmountUnpaid: number;       // Unpaid amount (due - paid)
  totalAmountWithheld: number;     // Amount to withhold
  averageAmount: number;           // Average amount from parent outflow

  // === STATUS ===
  isDuePeriod: boolean;
  duePeriodCount: number;          // Count of due occurrences
  dueDate?: Timestamp;
  status: OutflowPeriodStatus;

  // === PROGRESS METRICS ===
  paymentProgressPercentage: number; // (paid/due) × 100
  fullyPaidCount: number;          // Count of fully paid occurrences
  unpaidCount: number;             // Count of unpaid occurrences
  itemCount: number;               // Total occurrences in period

  // === GROUPING ===
  groupId: string;                 // Group association
}

// ============================================================================
// BUDGET SUMMARY DATA
// ============================================================================

/**
 * Budget-specific summary data for a period
 * Aggregates all budget_periods for a specific user/group/period
 */
export interface BudgetSummaryData {
  // === TOTALS ===
  totalAllocated: number;          // Total budget allocated
  totalSpent: number;              // Total actually spent
  totalRemaining: number;          // Budget remaining

  // === COUNTS ===
  totalCount: number;              // Total budgets with periods
  overBudgetCount: number;         // How many over budget
  underBudgetCount: number;        // How many under budget

  // === DETAILED ENTRIES (Optional) ===
  entries?: BudgetEntry[];
}

/**
 * Individual budget entry for detailed view
 * Enhanced to include all fields for frontend tile rendering
 */
export interface BudgetEntry {
  // === IDENTITY ===
  budgetId: string;
  budgetPeriodId: string;
  budgetName: string;
  categoryId: string;

  // === AMOUNTS ===
  maxAmount: number;               // Clearer name for allocated amount
  totalAllocated: number;          // Total amount allocated (backward compatibility)
  totalSpent: number;              // Total amount spent
  totalRemaining: number;          // Remaining amount
  averageBudget: number;           // Average budget from parent

  // === USER INPUT ===
  userNotes?: string;              // User notes from budget_period.userNotes

  // === PROGRESS METRICS ===
  progressPercentage: number;      // (spent/allocated) × 100
  checklistItemsCount?: number;
  checklistItemsCompleted?: number;
  checklistProgressPercentage?: number; // Checklist completion percentage

  // === STATUS ===
  isOverBudget: boolean;           // Whether spent > allocated
  overageAmount?: number;          // Amount over budget (if over)

  // === GROUPING ===
  groupId: string;                 // Group association
}

// ============================================================================
// INFLOW SUMMARY DATA
// ============================================================================

/**
 * Inflow-specific summary data for a period
 * Aggregates all inflow_periods for a specific user/group/period
 */
export interface InflowSummaryData {
  // === TOTALS ===
  totalExpectedIncome: number;     // Total income expected
  totalReceivedIncome: number;     // Total income received
  totalPendingIncome: number;      // Income not yet received

  // === COUNTS ===
  totalCount: number;              // Total inflows with periods
  receiptPeriodCount: number;      // How many incomes expected
  fullyReceivedCount: number;      // How many fully received
  pendingCount: number;            // How many pending

  // === DETAILED ENTRIES (Optional) ===
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
  // === IDENTITY ===
  inflowId: string;
  inflowPeriodId: string;
  description: string;
  source: string;                  // Employer, client, etc.
  userCustomName?: string;         // User's custom name override

  // === AMOUNTS ===
  totalExpected: number;           // Total expected income
  totalReceived: number;           // Total received income
  totalPending: number;            // Pending income (expected - received)
  averageAmount: number;           // Average amount from parent inflow
  amountPerOccurrence: number;     // Amount per occurrence

  // === STATUS ===
  isReceiptPeriod: boolean;
  expectedDate?: Timestamp;
  isRegularSalary: boolean;

  // === PROGRESS METRICS ===
  receiptProgressPercentage: number; // (received/expected) × 100
  dollarProgressPercentage: number;  // ($ received / $ expected) × 100
  isFullyReceived: boolean;        // Whether received >= expected
  isPending: boolean;              // Whether totalPending > 0

  // === OCCURRENCE TRACKING ===
  occurrenceCount: number;         // Total occurrences in period
  occurrencesPaid: number;         // Count of paid occurrences
  occurrenceDueDates: Timestamp[]; // Array of expected dates
  firstDueDateInPeriod?: Timestamp;
  lastDueDateInPeriod?: Timestamp;
  nextUnpaidDueDate?: Timestamp;

  // === PREDICTION ===
  nextPaymentPrediction?: InflowPaymentPrediction;

  // === GROUPING ===
  groupId: string;                 // Group association

  // === INCOME TYPE ===
  incomeType: string;              // 'salary' | 'freelance' | 'investment' | 'other'
}

// ============================================================================
// GOAL SUMMARY DATA
// ============================================================================

/**
 * Goal-specific summary data for a period
 * Aggregates all goal_periods for a specific user/group/period
 *
 * NOTE: Goals are not yet implemented, this is a placeholder
 */
export interface GoalSummaryData {
  // === TOTALS ===
  totalTargetAmount: number;       // Total goal targets
  totalSavedAmount: number;        // Total saved toward goals
  totalRemainingAmount: number;    // Total remaining to save

  // === COUNTS ===
  totalCount: number;              // Total active goals
  onTrackCount: number;            // Goals on track
  behindCount: number;             // Goals behind schedule
  completedCount: number;          // Goals completed this period

  // === DETAILED ENTRIES (Optional) ===
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

// ============================================================================
// USER PERIOD SUMMARY
// ============================================================================

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
  // === IDENTITY ===
  id: string;                      // Format: "{userId}_{periodType}_{sourcePeriodId}"
  userId: string;                  // Owner user ID
  sourcePeriodId: string;          // e.g., "2025-M11", "2025-W45", "2025-BM01-A"
  periodType: PeriodType;          // MONTHLY, WEEKLY, BI_MONTHLY

  // === PERIOD CONTEXT (Denormalized from source_periods) ===
  periodStartDate: Timestamp;      // Period start (UTC)
  periodEndDate: Timestamp;        // Period end (UTC)
  year: number;                    // 2025
  month?: number;                  // 1-12 for monthly/bi-monthly
  weekNumber?: number;             // 1-52 for weekly

  // === RESOURCE ENTRIES (Arrays for frontend calculation) ===
  outflows: OutflowEntry[];        // Array of individual outflow entries
  budgets: BudgetEntry[];          // Array of individual budget entries
  inflows: InflowEntry[];          // Array of individual inflow entries
  goals: GoalEntry[];              // Array of individual goal entries

  // NOTE: Cross-resource metrics (totalIncome, totalExpenses, netCashFlow, savingsRate)
  // are calculated on-the-fly in the frontend for better performance

  // === METADATA ===
  lastRecalculated: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// GROUP PERIOD SUMMARY
// ============================================================================

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
  // === IDENTITY ===
  id: string;                      // Format: "{groupId}_{periodType}_{sourcePeriodId}"
  groupId: string;                 // Group ID
  sourcePeriodId: string;
  periodType: PeriodType;

  // === PERIOD CONTEXT ===
  periodStartDate: Timestamp;
  periodEndDate: Timestamp;
  year: number;
  month?: number;
  weekNumber?: number;

  // === AGGREGATED RESOURCE DATA (Same structure as user summaries) ===
  outflows: OutflowSummaryData;
  budgets: BudgetSummaryData;
  inflows: InflowSummaryData;
  goals: GoalSummaryData;

  // === CROSS-RESOURCE METRICS ===
  totalIncome: number;
  totalExpenses: number;
  netCashFlow: number;
  savingsRate: number;

  // === GROUP-SPECIFIC METRICS ===
  memberContributions: {
    [userId: string]: {
      income: number;
      expenses: number;
      netContribution: number;
    };
  };

  // === METADATA ===
  lastRecalculated: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
