import { Timestamp } from "firebase-admin/firestore";
import { PeriodType } from "./index";

/**
 * Single outflow period's aggregated summary data
 * NOTE: sourcePeriodId is the object key in parent structure (e.g., "2025-M11")
 * NOTE: periodStartDate/periodEndDate removed - derivable from sourcePeriodId
 */
export interface OutflowPeriodEntry {
  // Period Identity
  periodId: string;                  // Unique outflow_period document ID
  outflowId: string;                 // Parent outflow ID (for name updates)
  groupId: string;                   // Group ID for this period
  merchant: string;                  // Merchant name (from outflow.merchantName)
  userCustomName: string;            // User's custom name (from outflow.userCustomName)

  // Amount Totals (flat structure, NOT nested)
  totalAmountDue: number;
  totalAmountPaid: number;
  totalAmountUnpaid: number;
  totalAmountWithheld: number;       // Total withheld for bills
  averageAmount: number;             // Average outflow amount

  // Due Status
  isDuePeriod: boolean;              // Is this period currently due
  duePeriodCount: number;            // Count of outflows due this period

  // Status Breakdown
  statusCounts: OutflowStatusCounts;

  // Progress Metrics
  paymentProgressPercentage: number; // (paid / due) × 100
  fullyPaidCount: number;
  unpaidCount: number;
  itemCount: number;                 // Items with periods in this range
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
  // Identity
  ownerId: string;                   // User ID or Group ID
  ownerType: 'user' | 'group';
  periodType: PeriodType;            // MONTHLY, WEEKLY, BI_MONTHLY
  resourceType: 'outflow';

  // Time Window
  windowStart: Timestamp;            // Start of 2-year window
  windowEnd: Timestamp;              // End of 2-year window

  // Summary Data (nested by sourcePeriodId for O(1) lookup)
  // Example: { "2025-M11": [...entries], "2025-M12": [...entries] }
  periods: {
    [sourcePeriodId: string]: OutflowPeriodEntry[];
  };

  // Metadata
  totalItemCount: number;            // Total active outflows
  lastRecalculated: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
