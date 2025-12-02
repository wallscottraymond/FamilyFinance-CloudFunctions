/**
 * Outflow Periods Types
 *
 * Types related to outflow periods (bill occurrences in specific time periods).
 */

import { Timestamp } from "firebase-admin/firestore";
import { BaseDocument } from "../../../../types/base";
import { PeriodType } from "../../../budgets/types";

// =======================
// OUTFLOW PERIOD ENUMS
// =======================

/**
 * Payment Type Classification
 */
export enum PaymentType {
  REGULAR = 'regular',
  CATCH_UP = 'catch_up',
  ADVANCE = 'advance',
  EXTRA_PRINCIPAL = 'extra_principal'
}

/**
 * Outflow Period Status
 */
export enum OutflowPeriodStatus {
  PENDING = 'pending',
  DUE_SOON = 'due_soon',
  PARTIAL = 'partial',
  PAID = 'paid',
  PAID_EARLY = 'paid_early',
  OVERDUE = 'overdue'
}

// =======================
// OUTFLOW PERIOD DOCUMENT
// =======================

/**
 * Outflow Period - FLAT STRUCTURE
 *
 * Represents a bill occurrence in a specific period.
 */
export interface OutflowPeriod extends BaseDocument {
  // === IDENTITY ===
  id: string;
  outflowId: string;
  sourcePeriodId: string;

  // === OWNERSHIP ===
  userId: string;
  groupId: string;                     // ✅ Group association (null = private)
  isActive: boolean;

  // === PLAID IDENTIFIERS ===
  accountId: string;
  itemId: string;

  // === FINANCIAL TRACKING (FLAT) ===
  actualAmount: number | null;
  amountWithheld: number;
  averageAmount: number;               // ✅ FLAT number
  expectedAmount: number;
  amountPerOccurrence: number;
  totalAmountDue: number;
  totalAmountPaid: number;
  totalAmountUnpaid: number;
  currency: string;                    // ✅ FLAT string

  // === TIMESTAMPS ===
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastCalculated: Timestamp;

  // === PAYMENT CYCLE ===
  cycleDays: number;
  cycleStartDate: Timestamp;
  cycleEndDate: Timestamp;
  dailyWithholdingRate: number;

  // === METADATA ===
  description: string;
  frequency: string;

  // === STATUS ===
  isPaid: boolean;
  isFullyPaid: boolean;
  isPartiallyPaid: boolean;
  isDuePeriod: boolean;
  isHidden: boolean;

  // === CATEGORIZATION ===
  plaidPrimaryCategory: string;
  plaidDetailedCategory: string;

  // === MERCHANT ===
  merchantName: string | null;

  // === PERIOD CONTEXT ===
  periodStartDate: Timestamp;
  periodEndDate: Timestamp;
  periodType: PeriodType;

  // === PREDICTION ===
  predictedNextDate: Timestamp | null;

  // === USER DATA ===
  tags: string[];
  note: string | null;

  // === TRANSACTIONS ===
  transactionIds: string[];

  // === MULTI-OCCURRENCE ===
  numberOfOccurrencesInPeriod: number;
  numberOfOccurrencesPaid: number;
  numberOfOccurrencesUnpaid: number;
  occurrenceDueDates: Timestamp[];
  occurrencePaidFlags: boolean[];
  occurrenceTransactionIds: (string | null)[];

  // === PROGRESS ===
  paymentProgressPercentage: number;
  dollarProgressPercentage: number;

  // === DUE DATES ===
  firstDueDateInPeriod: Timestamp | null;
  lastDueDateInPeriod: Timestamp | null;
  nextUnpaidDueDate: Timestamp | null;
}
