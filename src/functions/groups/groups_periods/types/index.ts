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
  // Identity
  groupId: string;
  periodId: string;            // e.g., '2025M12', '2025W50'
  periodType: 'weekly' | 'bi_monthly' | 'monthly' | 'annual';

  // Period boundaries
  periodStartDate: FirebaseFirestore.Timestamp;
  periodEndDate: FirebaseFirestore.Timestamp;
  isCurrent: boolean;

  // Activity metrics
  metrics: GroupPeriodMetrics;

  // Member activity
  activeMemberIds: string[];   // Members active this period

  // Metadata
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

/**
 * Group Period Metrics
 */
export interface GroupPeriodMetrics {
  // Resource counts
  totalOutflows: number;
  totalInflows: number;
  totalTransactions: number;
  totalBudgets: number;

  // Financial totals
  totalOutflowAmount: number;
  totalInflowAmount: number;
  totalTransactionAmount: number;

  // Activity
  resourcesShared: number;     // New resources shared this period
  resourcesModified: number;   // Existing resources modified

  // Member engagement
  activeMemberCount: number;
  contributingMemberCount: number; // Members who added/edited resources
}
