/**
 * Split Validation & Redistribution Utility
 *
 * Ensures that transaction splits always total to the transaction amount.
 * Automatically redistributes splits when totals don't match (within tolerance).
 *
 * Key Features:
 * - Proportional reduction for overages
 * - Unallocated split creation for underages
 * - Single split auto-adjustment
 * - Currency-safe rounding (2 decimals, minimum $0.01)
 * - Preserves all 18 TransactionSplit fields during redistribution
 *
 * @module transactions/utils/validate_and_redistribute_splits
 */
import { Timestamp } from '@google-cloud/firestore';
export interface TransactionSplit {
    splitId: string;
    budgetId: string;
    amount: number;
    description?: string | null;
    isDefault: boolean;
    monthlyPeriodId: string | null;
    weeklyPeriodId: string | null;
    biWeeklyPeriodId: string | null;
    outflowId?: string | null;
    plaidPrimaryCategory: string;
    plaidDetailedCategory: string;
    internalPrimaryCategory: string | null;
    internalDetailedCategory: string | null;
    isIgnored: boolean;
    isRefund: boolean;
    isTaxDeductible: boolean;
    ignoredReason?: string | null;
    refundReason?: string | null;
    paymentDate: Timestamp;
    rules: string[];
    tags: string[];
    createdAt: Timestamp;
    updatedAt: Timestamp;
}
export interface ValidateSplitsResult {
    is_valid: boolean;
    redistributed_splits?: TransactionSplit[];
    error?: string;
}
/**
 * Validate and redistribute transaction splits to match transaction amount
 *
 * @param transaction_amount - Total transaction amount
 * @param splits - Array of transaction splits
 * @returns Validation result with redistributed splits if needed
 */
export declare function validate_and_redistribute_splits(transaction_amount: number, splits: TransactionSplit[]): ValidateSplitsResult;
export interface LegacyValidateSplitsResult {
    isValid: boolean;
    redistributedSplits?: TransactionSplit[];
    error?: string;
}
/**
 * Legacy wrapper for backward compatibility
 */
export declare function validateAndRedistributeSplits(transactionAmount: number, splits: TransactionSplit[]): LegacyValidateSplitsResult;
//# sourceMappingURL=validate_and_redistribute_splits.d.ts.map