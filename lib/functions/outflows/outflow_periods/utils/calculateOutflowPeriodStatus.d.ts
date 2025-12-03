/**
 * Calculate Outflow Period Status Utility
 *
 * Determines the actual payment status of an outflow period based on:
 * - Transaction splits assigned to this period
 * - Due dates and current date
 * - Amount due vs amount paid
 *
 * This replaces the placeholder updateBillStatus function with intelligent
 * status calculation based on real payment data.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { TransactionSplitReference } from '../../../../types';
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
//# sourceMappingURL=calculateOutflowPeriodStatus.d.ts.map