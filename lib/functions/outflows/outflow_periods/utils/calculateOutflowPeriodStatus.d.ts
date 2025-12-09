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
import { TransactionSplitReference } from '../../../../types';
/**
 * Enhanced Status Result with Occurrence Information
 *
 * Returned by calculateEnhancedOutflowPeriodStatus for use in summaries
 */
export interface EnhancedOutflowPeriodStatusResult {
    status: string;
    hasOccurrenceTracking: boolean;
    numberOfOccurrences: number;
    numberOfOccurrencesPaid: number;
    numberOfOccurrencesUnpaid: number;
    occurrencePaymentPercentage: number;
    occurrenceStatusText: string | null;
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
export declare function calculateOutflowPeriodStatus(isDuePeriod: boolean, dueDate: Timestamp | undefined, expectedDueDate: Timestamp, amountDue: number, transactionSplits: TransactionSplitReference[]): string;
/**
 * Helper function to check if an outflow period has any payments
 *
 * @param transactionSplits - Array of transaction split references
 * @returns True if there are any payments assigned
 */
export declare function hasPayments(transactionSplits: TransactionSplitReference[]): boolean;
/**
 * Helper function to calculate total payment amount (excluding extra principal)
 *
 * @param transactionSplits - Array of transaction split references
 * @returns Total amount paid toward the bill
 */
export declare function calculateTotalPaid(transactionSplits: TransactionSplitReference[]): number;
/**
 * Helper function to calculate extra principal amount
 *
 * @param transactionSplits - Array of transaction split references
 * @returns Total extra principal paid
 */
export declare function calculateExtraPrincipal(transactionSplits: TransactionSplitReference[]): number;
/**
 * Helper function to get payment breakdown by type
 *
 * @param transactionSplits - Array of transaction split references
 * @returns Object with payment amounts by type
 */
export declare function getPaymentBreakdown(transactionSplits: TransactionSplitReference[]): {
    regular: number;
    catchUp: number;
    advance: number;
    extraPrincipal: number;
    total: number;
};
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
export declare function calculateEnhancedOutflowPeriodStatus(isDuePeriod: boolean, dueDate: Timestamp | undefined, expectedDueDate: Timestamp, amountDue: number, transactionSplits: TransactionSplitReference[], numberOfOccurrences?: number, numberOfOccurrencesPaid?: number, frequency?: string): EnhancedOutflowPeriodStatusResult;
//# sourceMappingURL=calculateOutflowPeriodStatus.d.ts.map