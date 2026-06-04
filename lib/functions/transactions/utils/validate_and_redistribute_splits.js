"use strict";
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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate_and_redistribute_splits = validate_and_redistribute_splits;
exports.validateAndRedistributeSplits = validateAndRedistributeSplits;
const firestore_1 = require("@google-cloud/firestore");
/**
 * Validate and redistribute transaction splits to match transaction amount
 *
 * @param transaction_amount - Total transaction amount
 * @param splits - Array of transaction splits
 * @returns Validation result with redistributed splits if needed
 */
function validate_and_redistribute_splits(transaction_amount, splits) {
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
    let redistributed_splits;
    // Case 1: Single split with large difference - auto-adjust
    // (if difference > 10% of transaction amount, just adjust the split)
    if (splits.length === 1 && difference > transaction_amount * 0.1) {
        redistributed_splits = [
            Object.assign(Object.assign({}, splits[0]), { amount: round_to_cents(transaction_amount) })
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
function redistribute_overage(splits, transaction_amount, total_splits) {
    const ratio = transaction_amount / total_splits;
    // Proportionally reduce each split
    const redistributed = splits.map((split, index) => (Object.assign(Object.assign({}, split), { amount: round_to_cents(split.amount * ratio), __original_index: index // Track original position
     })));
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
        const _a = split, { __original_index } = _a, split_without_index = __rest(_a, ["__original_index"]);
        return Object.assign(Object.assign({}, split_without_index), { amount: Math.max(0.01, split.amount) });
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
function redistribute_underage(splits, transaction_amount, total_splits) {
    var _a;
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
        const largest_split_index = valid_splits.reduce((max_idx, split, idx, arr) => split.amount > arr[max_idx].amount ? idx : max_idx, 0);
        valid_splits[largest_split_index] = Object.assign(Object.assign({}, valid_splits[largest_split_index]), { amount: round_to_cents(valid_splits[largest_split_index].amount + remainder) });
        return valid_splits;
    }
    // Create unallocated split for the remainder
    const unallocated_split = {
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
        paymentDate: ((_a = splits[0]) === null || _a === void 0 ? void 0 : _a.paymentDate) || firestore_1.Timestamp.now(),
        rules: [],
        tags: [],
        createdAt: firestore_1.Timestamp.now(),
        updatedAt: firestore_1.Timestamp.now()
    };
    return [...valid_splits, unallocated_split];
}
/**
 * Round amount to cents (2 decimal places) with proper rounding
 */
function round_to_cents(amount) {
    return Math.round(amount * 100) / 100;
}
/**
 * Legacy wrapper for backward compatibility
 */
function validateAndRedistributeSplits(transactionAmount, splits) {
    const result = validate_and_redistribute_splits(transactionAmount, splits);
    return {
        isValid: result.is_valid,
        redistributedSplits: result.redistributed_splits,
        error: result.error
    };
}
//# sourceMappingURL=validate_and_redistribute_splits.js.map