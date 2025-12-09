/**
 * Calculate Outflow Period Status Utility
 *
 * Determines the actual payment status of an outflow period based on:
 * - Transaction splits assigned to this period
 * - Due dates and current date
 * - Amount due vs amount paid
 * - Occurrence-based payment tracking (for multi-occurrence periods)
 *
 * This replaces the placeholder updateBillStatus function with intelligent
 * status calculation based on real payment data.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { TransactionSplitReference, OutflowPeriodStatus, PaymentType } from '../../../../types';

/**
 * Enhanced Status Result with Occurrence Information
 *
 * Returned by calculateEnhancedOutflowPeriodStatus for use in summaries
 */
export interface EnhancedOutflowPeriodStatusResult {
  status: string;                          // Primary status (paid, pending, overdue, etc.)
  hasOccurrenceTracking: boolean;          // Whether this period tracks occurrences
  numberOfOccurrences: number;             // Total occurrences (0 if no tracking)
  numberOfOccurrencesPaid: number;         // Paid occurrences (0 if no tracking)
  numberOfOccurrencesUnpaid: number;       // Unpaid occurrences (0 if no tracking)
  occurrencePaymentPercentage: number;     // Percentage of occurrences paid (0-100)
  occurrenceStatusText: string | null;     // Human-readable text: "2 of 4 weeks paid"
}

/**
 * Calculate the status of an outflow period based on payments and due dates
 *
 * @param isDuePeriod - Whether the bill is due in this period
 * @param dueDate - The actual due date if bill is due in this period
 * @param expectedDueDate - The expected due date for planning purposes
 * @param amountDue - The amount due for this period (billAmount if due, else 0)
 * @param transactionSplits - Array of transaction split references assigned to this period
 * @returns The calculated status string
 *
 * Status logic:
 * - "paid" - Fully paid (totalPaid >= amountDue)
 * - "paid_early" - Paid before due date
 * - "partial" - Partially paid (0 < totalPaid < amountDue)
 * - "overdue" - Past due date, unpaid or underpaid
 * - "due_soon" - Due within 3 days
 * - "pending" - Default: not yet due, no payments
 */
export function calculateOutflowPeriodStatus(
  isDuePeriod: boolean,
  dueDate: Timestamp | undefined,
  expectedDueDate: Timestamp,
  amountDue: number,
  transactionSplits: TransactionSplitReference[]
): string {
  const now = Timestamp.now();

  // Calculate total payments from transaction splits
  // Exclude extra_principal payments from the total, as they're above and beyond the required amount
  const totalPaid = transactionSplits.reduce((sum, split) => {
    // Only count regular, catch_up, and advance payments toward bill payment
    if (split.paymentType !== PaymentType.EXTRA_PRINCIPAL) {
      return sum + split.amount;
    }
    return sum;
  }, 0);

  // If this is a due period (amountDue > 0)
  if (isDuePeriod && amountDue > 0) {
    // If amount is fully paid or overpaid
    if (totalPaid >= amountDue) {
      // Check if paid before due date
      if (dueDate && dueDate.toMillis() > now.toMillis()) {
        return OutflowPeriodStatus.PAID_EARLY;
      }
      return OutflowPeriodStatus.PAID;
    }

    // If partially paid (some payment, but not enough)
    if (totalPaid > 0 && totalPaid < amountDue) {
      // Check if we're past due date
      if (dueDate && dueDate.toMillis() < now.toMillis()) {
        return OutflowPeriodStatus.OVERDUE; // Past due and still underpaid
      }
      return OutflowPeriodStatus.PARTIAL; // Partial payment, still within timeframe
    }

    // No payments yet for due period
    if (totalPaid === 0) {
      // Check if overdue
      if (dueDate && dueDate.toMillis() < now.toMillis()) {
        return OutflowPeriodStatus.OVERDUE;
      }

      // Check if due soon (within 3 days)
      if (dueDate) {
        const msUntilDue = dueDate.toMillis() - now.toMillis();
        const threeDaysInMs = 3 * 24 * 60 * 60 * 1000;
        if (msUntilDue > 0 && msUntilDue < threeDaysInMs) {
          return OutflowPeriodStatus.DUE_SOON;
        }
      }
    }
  }

  // If this is NOT a due period (amountDue = 0) but has payments assigned
  // Mark as paid if there are any payments (user has assigned transaction to this period)
  if (!isDuePeriod && totalPaid > 0) {
    return OutflowPeriodStatus.PAID;
  }

  // Default: pending (not yet due, no payments)
  return OutflowPeriodStatus.PENDING;
}

/**
 * Helper function to check if an outflow period has any payments
 *
 * @param transactionSplits - Array of transaction split references
 * @returns True if there are any payments assigned
 */
export function hasPayments(transactionSplits: TransactionSplitReference[]): boolean {
  return transactionSplits.length > 0;
}

/**
 * Helper function to calculate total payment amount (excluding extra principal)
 *
 * @param transactionSplits - Array of transaction split references
 * @returns Total amount paid toward the bill
 */
export function calculateTotalPaid(transactionSplits: TransactionSplitReference[]): number {
  return transactionSplits.reduce((sum, split) => {
    if (split.paymentType !== PaymentType.EXTRA_PRINCIPAL) {
      return sum + split.amount;
    }
    return sum;
  }, 0);
}

/**
 * Helper function to calculate extra principal amount
 *
 * @param transactionSplits - Array of transaction split references
 * @returns Total extra principal paid
 */
export function calculateExtraPrincipal(transactionSplits: TransactionSplitReference[]): number {
  return transactionSplits.reduce((sum, split) => {
    if (split.paymentType === PaymentType.EXTRA_PRINCIPAL) {
      return sum + split.amount;
    }
    return sum;
  }, 0);
}

/**
 * Helper function to get payment breakdown by type
 *
 * @param transactionSplits - Array of transaction split references
 * @returns Object with payment amounts by type
 */
export function getPaymentBreakdown(transactionSplits: TransactionSplitReference[]): {
  regular: number;
  catchUp: number;
  advance: number;
  extraPrincipal: number;
  total: number;
} {
  const breakdown = {
    regular: 0,
    catchUp: 0,
    advance: 0,
    extraPrincipal: 0,
    total: 0
  };

  transactionSplits.forEach(split => {
    breakdown.total += split.amount;

    switch (split.paymentType) {
      case PaymentType.REGULAR:
        breakdown.regular += split.amount;
        break;
      case PaymentType.CATCH_UP:
        breakdown.catchUp += split.amount;
        break;
      case PaymentType.ADVANCE:
        breakdown.advance += split.amount;
        break;
      case PaymentType.EXTRA_PRINCIPAL:
        breakdown.extraPrincipal += split.amount;
        break;
    }
  });

  return breakdown;
}

/**
 * Calculate Enhanced Outflow Period Status with Occurrence Information
 *
 * This function extends the basic status calculation to include occurrence-based
 * payment tracking for multi-occurrence periods (e.g., weekly bills in monthly periods).
 *
 * @param isDuePeriod - Whether the bill is due in this period
 * @param dueDate - The actual due date if bill is due in this period
 * @param expectedDueDate - The expected due date for planning purposes
 * @param amountDue - The amount due for this period
 * @param transactionSplits - Array of transaction split references assigned to this period
 * @param numberOfOccurrences - Total number of occurrences in this period (0 if no tracking)
 * @param numberOfOccurrencesPaid - Number of paid occurrences (from occurrence matching)
 * @param frequency - Outflow frequency (WEEKLY, MONTHLY, etc.)
 * @returns Enhanced status result with occurrence information
 *
 * Example Output:
 * {
 *   status: "partial",
 *   hasOccurrenceTracking: true,
 *   numberOfOccurrences: 4,
 *   numberOfOccurrencesPaid: 2,
 *   numberOfOccurrencesUnpaid: 2,
 *   occurrencePaymentPercentage: 50,
 *   occurrenceStatusText: "2 of 4 weeks paid"
 * }
 */
export function calculateEnhancedOutflowPeriodStatus(
  isDuePeriod: boolean,
  dueDate: Timestamp | undefined,
  expectedDueDate: Timestamp,
  amountDue: number,
  transactionSplits: TransactionSplitReference[],
  numberOfOccurrences: number = 0,
  numberOfOccurrencesPaid: number = 0,
  frequency: string = 'MONTHLY'
): EnhancedOutflowPeriodStatusResult {
  // Calculate basic status using existing function
  const status = calculateOutflowPeriodStatus(
    isDuePeriod,
    dueDate,
    expectedDueDate,
    amountDue,
    transactionSplits
  );

  // Determine if this period has occurrence tracking
  const hasOccurrenceTracking = numberOfOccurrences > 0;

  // Calculate occurrence metrics
  const numberOfOccurrencesUnpaid = hasOccurrenceTracking
    ? numberOfOccurrences - numberOfOccurrencesPaid
    : 0;

  const occurrencePaymentPercentage = hasOccurrenceTracking && numberOfOccurrences > 0
    ? Math.round((numberOfOccurrencesPaid / numberOfOccurrences) * 100)
    : 0;

  // Generate human-readable occurrence status text
  let occurrenceStatusText: string | null = null;

  if (hasOccurrenceTracking) {
    // Determine frequency unit for display
    const frequencyUnit = getFrequencyUnit(frequency);

    // Generate status text: "2 of 4 weeks paid"
    occurrenceStatusText = `${numberOfOccurrencesPaid} of ${numberOfOccurrences} ${frequencyUnit} paid`;
  }

  return {
    status,
    hasOccurrenceTracking,
    numberOfOccurrences: hasOccurrenceTracking ? numberOfOccurrences : 0,
    numberOfOccurrencesPaid: hasOccurrenceTracking ? numberOfOccurrencesPaid : 0,
    numberOfOccurrencesUnpaid,
    occurrencePaymentPercentage,
    occurrenceStatusText
  };
}

/**
 * Helper function to get frequency unit for display
 *
 * @param frequency - Outflow frequency (WEEKLY, BIWEEKLY, MONTHLY, etc.)
 * @returns Human-readable frequency unit (pluralized)
 *
 * Examples:
 * - WEEKLY → "weeks"
 * - BIWEEKLY → "bi-weekly periods"
 * - MONTHLY → "months"
 */
function getFrequencyUnit(frequency: string): string {
  const freq = frequency.toUpperCase();

  switch (freq) {
    case 'WEEKLY':
      return 'weeks';
    case 'BIWEEKLY':
      return 'bi-weekly periods';
    case 'SEMI_MONTHLY':
      return 'semi-monthly periods';
    case 'MONTHLY':
      return 'months';
    case 'ANNUALLY':
      return 'annual periods';
    default:
      return 'occurrences';
  }
}
