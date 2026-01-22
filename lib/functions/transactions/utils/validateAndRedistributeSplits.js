"use strict";
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
exports.validateAndRedistributeSplits = validateAndRedistributeSplits;
const firestore_1 = require("@google-cloud/firestore");
/**
 * Validate and redistribute transaction splits to match transaction amount
 *
 * @param transactionAmount - Total transaction amount
 * @param splits - Array of transaction splits
 * @returns Validation result with redistributed splits if needed
 */
function validateAndRedistributeSplits(transactionAmount, splits) {
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
    let redistributedSplits;
    // Case 1: Single split with large difference - auto-adjust
    // (if difference > 10% of transaction amount, just adjust the split)
    if (splits.length === 1 && difference > transactionAmount * 0.1) {
        redistributedSplits = [
            Object.assign(Object.assign({}, splits[0]), { amount: roundToCents(transactionAmount) })
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
function redistributeOverage(splits, transactionAmount, totalSplits) {
    const ratio = transactionAmount / totalSplits;
    // Proportionally reduce each split
    const redistributed = splits.map((split, index) => (Object.assign(Object.assign({}, split), { amount: roundToCents(split.amount * ratio), __originalIndex: index // Track original position
     })));
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
        const _a = split, { __originalIndex } = _a, splitWithoutIndex = __rest(_a, ["__originalIndex"]);
        return Object.assign(Object.assign({}, splitWithoutIndex), { amount: Math.max(0.01, split.amount) });
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
function redistributeUnderage(splits, transactionAmount, totalSplits) {
    var _a;
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
        const largestSplitIndex = validSplits.reduce((maxIdx, split, idx, arr) => split.amount > arr[maxIdx].amount ? idx : maxIdx, 0);
        validSplits[largestSplitIndex] = Object.assign(Object.assign({}, validSplits[largestSplitIndex]), { amount: roundToCents(validSplits[largestSplitIndex].amount + remainder) });
        return validSplits;
    }
    // Create unallocated split for the remainder
    const unallocatedSplit = {
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
    return [...validSplits, unallocatedSplit];
}
/**
 * Round amount to cents (2 decimal places) with proper rounding
 */
function roundToCents(amount) {
    return Math.round(amount * 100) / 100;
}
//# sourceMappingURL=validateAndRedistributeSplits.js.map