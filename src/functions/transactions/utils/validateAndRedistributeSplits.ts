import { Timestamp } from '@google-cloud/firestore';

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
 */

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
  isValid: boolean;
  redistributedSplits?: TransactionSplit[];
  error?: string;
}

/**
 * Validate and redistribute transaction splits to match transaction amount
 *
 * @param transactionAmount - Total transaction amount
 * @param splits - Array of transaction splits
 * @returns Validation result with redistributed splits if needed
 */
export function validateAndRedistributeSplits(
  transactionAmount: number,
  splits: TransactionSplit[]
): ValidateSplitsResult {
  // Validate inputs
  if (!splits || splits.length === 0) {
    return {
      isValid: false,
      error: 'No splits provided'
    };
  }

  // Calculate total of all splits
  const totalSplits = splits.reduce((sum, split) => sum + split.amount, 0);

  // Check difference
  const difference = Math.abs(transactionAmount - totalSplits);
  const tolerance = 0.01; // $0.01 tolerance for floating-point precision

  // Check if any split is below minimum threshold (only for non-zero transactions)
  const hasInvalidSplit = transactionAmount > 0 && splits.some(split => split.amount < 0.01 && split.amount > 0);

  // If within tolerance AND no splits below minimum, splits are valid
  if (difference <= tolerance && !hasInvalidSplit) {
    return {
      isValid: true
    };
  }

  // Need redistribution
  console.log(`[validateAndRedistributeSplits] Redistribution needed: transaction=${transactionAmount}, splits total=${totalSplits}, diff=${difference}`);

  // Handle different redistribution scenarios
  let redistributedSplits: TransactionSplit[];

  // Case 1: Single split with large difference - auto-adjust
  // (if difference > 10% of transaction amount, just adjust the split)
  if (splits.length === 1 && difference > transactionAmount * 0.1) {
    redistributedSplits = [
      {
        ...splits[0],
        amount: roundToCents(transactionAmount)
      }
    ];
  }
  // Case 2: Overage (splits > transaction) - proportionally reduce
  else if (totalSplits > transactionAmount) {
    redistributedSplits = redistributeOverage(splits, transactionAmount, totalSplits);
  }
  // Case 3: Underage (splits < transaction) - add unallocated split
  // (includes single split with small difference < 10%)
  else {
    redistributedSplits = redistributeUnderage(splits, transactionAmount, totalSplits);
  }

  return {
    isValid: false,
    redistributedSplits
  };
}

/**
 * Redistribute splits when total exceeds transaction amount (proportional reduction)
 */
function redistributeOverage(
  splits: TransactionSplit[],
  transactionAmount: number,
  totalSplits: number
): TransactionSplit[] {
  const ratio = transactionAmount / totalSplits;

  // Proportionally reduce each split
  const redistributed = splits.map((split, index) => ({
    ...split,
    amount: roundToCents(split.amount * ratio),
    __originalIndex: index  // Track original position
  }));

  // Handle rounding errors - ensure total equals transaction amount
  let newTotal = redistributed.reduce((sum, s) => sum + s.amount, 0);
  let roundingDiff = roundToCents(transactionAmount - newTotal);

  // Distribute rounding difference across splits (starting from last split)
  if (Math.abs(roundingDiff) >= 0.01) {
    let remaining = Math.abs(roundingDiff);
    const increment = roundingDiff > 0 ? 0.01 : -0.01;

    // Add cents to last splits first (iterate backwards)
    for (let i = redistributed.length - 1; i >= 0 && remaining >= 0.01; i--) {
      redistributed[i].amount = roundToCents(redistributed[i].amount + increment);
      remaining = roundToCents(remaining - 0.01);
    }
  }

  // Ensure no split rounds to $0.00 (minimum $0.01)
  const final = redistributed.map(split => {
    const { __originalIndex, ...splitWithoutIndex } = split as any;
    return {
      ...splitWithoutIndex,
      amount: Math.max(0.01, split.amount)
    };
  });

  // Verify final total (defensive check)
  const finalTotal = final.reduce((sum, s) => sum + s.amount, 0);
  if (Math.abs(finalTotal - transactionAmount) > 0.01) {
    console.warn(`[validateAndRedistributeSplits] Rounding error: expected ${transactionAmount}, got ${finalTotal}`);
  }

  return final;
}

/**
 * Redistribute splits when total is less than transaction amount (add unallocated)
 */
function redistributeUnderage(
  splits: TransactionSplit[],
  transactionAmount: number,
  totalSplits: number
): TransactionSplit[] {
  // Filter out splits below minimum threshold and sum their amounts
  const validSplits = splits.filter(split => split.amount >= 0.01);
  const tinySplitsTotal = splits
    .filter(split => split.amount < 0.01)
    .reduce((sum, split) => sum + split.amount, 0);

  // Calculate remainder including tiny splits that were removed
  const remainder = roundToCents(transactionAmount - totalSplits + tinySplitsTotal);

  // If remainder is below minimum threshold, add it to the largest valid split
  if (remainder < 0.01 && validSplits.length > 0) {
    // Find largest split and add remainder to it
    const largestSplitIndex = validSplits.reduce((maxIdx, split, idx, arr) =>
      split.amount > arr[maxIdx].amount ? idx : maxIdx, 0
    );

    validSplits[largestSplitIndex] = {
      ...validSplits[largestSplitIndex],
      amount: roundToCents(validSplits[largestSplitIndex].amount + remainder)
    };

    return validSplits;
  }

  // Create unallocated split for the remainder
  const unallocatedSplit: TransactionSplit = {
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

  return [...validSplits, unallocatedSplit];
}

/**
 * Round amount to cents (2 decimal places) with proper rounding
 */
function roundToCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}
