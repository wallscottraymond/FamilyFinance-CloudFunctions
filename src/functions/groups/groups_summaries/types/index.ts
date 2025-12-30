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
  // Identity
  groupId: string;
  summaryId: string;           // e.g., '2025M12', '2025W50'
  periodType: 'weekly' | 'bi_monthly' | 'monthly' | 'annual';

  // Period boundaries
  periodStartDate: FirebaseFirestore.Timestamp;
  periodEndDate: FirebaseFirestore.Timestamp;

  // Summary data
  totalOutflows: number;       // Count of outflows
  totalAmount: number;         // Total amount across all outflows
  totalPaid: number;           // Total amount paid
  totalUnpaid: number;         // Total amount unpaid

  // Categorization
  byExpenseType: {
    [key: string]: {           // e.g., 'subscription', 'utility', 'rent'
      count: number;
      total: number;
      paid: number;
      unpaid: number;
    };
  };

  // Individual outflow entries
  outflows: GroupOutflowEntry[];

  // Metadata
  lastUpdated: FirebaseFirestore.Timestamp;
  contributingUserIds: string[];  // Users who have outflows in this summary
}

/**
 * Individual outflow entry in group summary
 */
export interface GroupOutflowEntry {
  outflowId: string;
  userId: string;              // Who owns this outflow
  merchant: string;
  averageAmount: number;
  totalAmountDue: number;
  totalAmountPaid: number;
  totalAmountUnpaid: number;

  // Period-specific data
  periodId: string;
  isDuePeriod: boolean;
  isCurrent: boolean;

  // Occurrences
  itemCount: number;           // Total occurrences
  fullyPaidCount: number;      // Paid occurrences

  // Next due date
  nextUnpaidDueDate?: FirebaseFirestore.Timestamp;
}

/**
 * Group Inflow Summary Document
 *
 * Aggregated summary of all inflows shared with a group.
 * Lives at: /group_summaries/{groupId}/inflow_summaries/{summaryId}
 */
export interface GroupInflowSummary {
  // Identity
  groupId: string;
  summaryId: string;
  periodType: 'weekly' | 'bi_monthly' | 'monthly' | 'annual';

  // Period boundaries
  periodStartDate: FirebaseFirestore.Timestamp;
  periodEndDate: FirebaseFirestore.Timestamp;

  // Summary data
  totalInflows: number;
  totalAmount: number;
  totalReceived: number;
  totalPending: number;

  // Categorization
  byIncomeType: {
    [key: string]: {           // e.g., 'salary', 'freelance', 'investment'
      count: number;
      total: number;
      received: number;
      pending: number;
    };
  };

  // Individual inflow entries
  inflows: GroupInflowEntry[];

  // Metadata
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

  // Period-specific data
  periodId: string;
  isExpectedPeriod: boolean;
  isCurrent: boolean;

  // Next expected date
  nextExpectedDate?: FirebaseFirestore.Timestamp;
}
