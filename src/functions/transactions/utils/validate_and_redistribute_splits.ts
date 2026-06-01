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
export function validate_and_redistribute_splits(
  transaction_amount: number,
  splits: TransactionSplit[]
): ValidateSplitsResult {
  // Validate inputs
  if (!splits || splits.length === 0) {
    return {
      is_valid: false,
      error: 'No splits provided'
    };
  }

  // Calculate total of all splits
  const total_splits = splits.reduce((sum, split) => sum + split.amount, 0);

  // Check difference
  const difference = Math.abs(transaction_amount - total_splits);
  const tolerance = 0.01; // $0.01 tolerance for floating-point precision

  // Check if any split is below minimum threshold (only for non-zero transactions)
  const has_invalid_split = transaction_amount > 0 && splits.some(split => split.amount < 0.01 && split.amount > 0);

  // If within tolerance AND no splits below minimum, splits are valid
  if (difference <= tolerance && !has_invalid_split) {
    return {
      is_valid: true
    };
  }

  // Need redistribution
  console.log(`[validate_and_redistribute_splits] Redistribution needed: transaction=${transaction_amount}, splits total=${total_splits}, diff=${difference}`);

  // Handle different redistribution scenarios
  let redistributed_splits: TransactionSplit[];

  // Case 1: Single split with large difference - auto-adjust
  // (if difference > 10% of transaction amount, just adjust the split)
  if (splits.length === 1 && difference > transaction_amount * 0.1) {
    redistributed_splits = [
      {
        ...splits[0],
        amount: round_to_cents(transaction_amount)
      }
    ];
  }
  // Case 2: Overage (splits > transaction) - proportionally reduce
  else if (total_splits > transaction_amount) {
    redistributed_splits = redistribute_overage(splits, transaction_amount, total_splits);
  }
  // Case 3: Underage (splits < transaction) - add unallocated split
  // (includes single split with small difference < 10%)
  else {
    redistributed_splits = redistribute_underage(splits, transaction_amount, total_splits);
  }

  return {
    is_valid: false,
    redistributed_splits
  };
}

/**
 * Redistribute splits when total exceeds transaction amount (proportional reduction)
 */
function redistribute_overage(
  splits: TransactionSplit[],
  transaction_amount: number,
  total_splits: number
): TransactionSplit[] {
  const ratio = transaction_amount / total_splits;

  // Proportionally reduce each split
  const redistributed = splits.map((split, index) => ({
    ...split,
    amount: round_to_cents(split.amount * ratio),
    __original_index: index  // Track original position
  }));

  // Handle rounding errors - ensure total equals transaction amount
  let new_total = redistributed.reduce((sum, s) => sum + s.amount, 0);
  let rounding_diff = round_to_cents(transaction_amount - new_total);

  // Distribute rounding difference across splits (starting from last split)
  if (Math.abs(rounding_diff) >= 0.01) {
    let remaining = Math.abs(rounding_diff);
    const increment = rounding_diff > 0 ? 0.01 : -0.01;

    // Add cents to last splits first (iterate backwards)
    for (let i = redistributed.length - 1; i >= 0 && remaining >= 0.01; i--) {
      redistributed[i].amount = round_to_cents(redistributed[i].amount + increment);
      remaining = round_to_cents(remaining - 0.01);
    }
  }

  // Ensure no split rounds to $0.00 (minimum $0.01)
  const final = redistributed.map(split => {
    const { __original_index, ...split_without_index } = split as any;
    return {
      ...split_without_index,
      amount: Math.max(0.01, split.amount)
    };
  });

  // Verify final total (defensive check)
  const final_total = final.reduce((sum, s) => sum + s.amount, 0);
  if (Math.abs(final_total - transaction_amount) > 0.01) {
    console.warn(`[validate_and_redistribute_splits] Rounding error: expected ${transaction_amount}, got ${final_total}`);
  }

  return final;
}

/**
 * Redistribute splits when total is less than transaction amount (add unallocated)
 */
function redistribute_underage(
  splits: TransactionSplit[],
  transaction_amount: number,
  total_splits: number
): TransactionSplit[] {
  // Filter out splits below minimum threshold and sum their amounts
  const valid_splits = splits.filter(split => split.amount >= 0.01);
  const tiny_splits_total = splits
    .filter(split => split.amount < 0.01)
    .reduce((sum, split) => sum + split.amount, 0);

  // Calculate remainder including tiny splits that were removed
  const remainder = round_to_cents(transaction_amount - total_splits + tiny_splits_total);

  // If remainder is below minimum threshold, add it to the largest valid split
  if (remainder < 0.01 && valid_splits.length > 0) {
    // Find largest split and add remainder to it
    const largest_split_index = valid_splits.reduce((max_idx, split, idx, arr) =>
      split.amount > arr[max_idx].amount ? idx : max_idx, 0
    );

    valid_splits[largest_split_index] = {
      ...valid_splits[largest_split_index],
      amount: round_to_cents(valid_splits[largest_split_index].amount + remainder)
    };

    return valid_splits;
  }

  // Create unallocated split for the remainder
  const unallocated_split: TransactionSplit = {
    splitId: `unallocated_${Date.now()}`,
    budgetId: 'unassigned',
    amount: remainder,
    description: 'Unallocated',
    isDefault: false,
    monthlyPeriodId: null,
    weeklyPeriodId: null,
    biWeeklyPeriodId: null,
    outflowId: null,
    plaidPrimaryCategory: 'Uncategorized',
    plaidDetailedCategory: 'Uncategorized',
    internalPrimaryCategory: null,
    internalDetailedCategory: null,
    isIgnored: false,
    isRefund: false,
    isTaxDeductible: false,
    ignoredReason: null,
    refundReason: null,
    paymentDate: splits[0]?.paymentDate || Timestamp.now(),
    rules: [],
    tags: [],
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now()
  };

  return [...valid_splits, unallocated_split];
}

/**
 * Round amount to cents (2 decimal places) with proper rounding
 */
function round_to_cents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

// Legacy interface for backward compatibility
export interface LegacyValidateSplitsResult {
  isValid: boolean;
  redistributedSplits?: TransactionSplit[];
  error?: string;
}

/**
 * Legacy wrapper for backward compatibility
 */
export function validateAndRedistributeSplits(
  transactionAmount: number,
  splits: TransactionSplit[]
): LegacyValidateSplitsResult {
  const result = validate_and_redistribute_splits(transactionAmount, splits);
  return {
    isValid: result.is_valid,
    redistributedSplits: result.redistributed_splits,
    error: result.error
  };
}
