import { Timestamp } from "firebase-admin/firestore";
import { PeriodType } from "./index";

/**
 * Merchant summary for a period
 */
export interface MerchantSummary {
  merchant: string;              // Merchant/vendor name
  count: number;                 // Number of outflows to this merchant
  totalAmount: number;           // Total amount for this merchant
}

/**
 * Single outflow period's aggregated summary data
 */
export interface OutflowPeriodEntry {
  // Period Identity
  periodId: string;                  // e.g., "2025M01" (sourcePeriodId)
  groupId: string;                   // Group ID for this period
  name: string;                      // Denormalized from parent outflow (customName || merchantName)
  periodStartDate: Timestamp;
  periodEndDate: Timestamp;

  // Amount Totals (flat structure, NOT nested)
  totalAmountDue: number;
  totalAmountPaid: number;
  totalAmountUnpaid: number;
  totalAmountWithheld: number;       // Total withheld for bills
  averageAmount: number;             // Average outflow amount

  // Due Status
  isDuePeriod: boolean;              // Is this period currently due
  duePeriodCount: number;            // Count of outflows due this period

  // Merchant Information
  merchantBreakdown: MerchantSummary[];  // Top 5 merchants for period

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

  // Summary Data (organized by sourcePeriodId)
  periods: OutflowPeriodEntry[];     // Array of period summaries

  // Metadata
  totalItemCount: number;            // Total active outflows
  lastRecalculated: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
