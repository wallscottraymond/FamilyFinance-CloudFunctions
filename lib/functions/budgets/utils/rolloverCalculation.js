"use strict";
/**
 * Budget Rollover Calculation Utility
 *
 * Handles real-time calculation of rollover amounts between budget periods.
 * Rollover carries surplus (underspend) or deficit (overspend) from previous periods.
 *
 * Key behaviors:
 * - Per-budget settings override global user preferences
 * - Both prime and non-prime periods calculate rollover independently
 * - Spread strategy distributes overspend across multiple periods (max 6)
 * - Extreme overspend can result in negative remaining amounts
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEffectiveRolloverSettings = getEffectiveRolloverSettings;
exports.calculateRolloverForPeriod = calculateRolloverForPeriod;
exports.calculateEffectiveRemaining = calculateEffectiveRemaining;
exports.findPreviousPeriodOfSameType = findPreviousPeriodOfSameType;
exports.isPeriodInPast = isPeriodInPast;
const firestore_1 = require("firebase-admin/firestore");
/**
 * Get effective rollover settings for a budget.
 * Per-budget settings take precedence over global user preferences.
 *
 * @param budget - The budget document
 * @param userFinancialSettings - User's global financial settings (optional)
 * @returns Resolved rollover settings
 */
function getEffectiveRolloverSettings(budget, userFinancialSettings) {
    var _a, _b, _c, _d, _e, _f;
    // Default values if nothing is set
    const defaults = {
        enabled: true,
        strategy: 'spread',
        spreadPeriods: 3,
    };
    // Get global settings from user preferences
    const globalEnabled = (_a = userFinancialSettings === null || userFinancialSettings === void 0 ? void 0 : userFinancialSettings.budgetRolloverEnabled) !== null && _a !== void 0 ? _a : defaults.enabled;
    const globalStrategy = (_b = userFinancialSettings === null || userFinancialSettings === void 0 ? void 0 : userFinancialSettings.budgetRolloverStrategy) !== null && _b !== void 0 ? _b : defaults.strategy;
    const globalSpreadPeriods = (_c = userFinancialSettings === null || userFinancialSettings === void 0 ? void 0 : userFinancialSettings.budgetRolloverSpreadPeriods) !== null && _c !== void 0 ? _c : defaults.spreadPeriods;
    // Per-budget settings override global (use ?? to allow explicit false)
    return {
        enabled: (_d = budget.rolloverEnabled) !== null && _d !== void 0 ? _d : globalEnabled,
        strategy: (_e = budget.rolloverStrategy) !== null && _e !== void 0 ? _e : globalStrategy,
        spreadPeriods: Math.min(6, Math.max(1, (_f = budget.rolloverSpreadPeriods) !== null && _f !== void 0 ? _f : globalSpreadPeriods)),
    };
}
/**
 * Calculate the rollover amount for a budget period.
 *
 * This function performs real-time calculation based on the previous period's
 * spending and any pending spread deductions.
 *
 * @param currentPeriod - The period to calculate rollover for
 * @param previousPeriod - The previous period of the same type (null for first period)
 * @param rolloverSettings - Resolved rollover settings for this budget
 * @returns Rollover calculation result
 */
function calculateRolloverForPeriod(currentPeriod, previousPeriod, rolloverSettings) {
    var _a, _b, _c, _d, _e, _f;
    // No rollover if disabled or no previous period
    if (!rolloverSettings.enabled || !previousPeriod) {
        return {
            rolledOverAmount: 0,
            rolledOverFromPeriodId: null,
            pendingRolloverDeduction: 0,
            pendingRolloverPeriods: 0,
        };
    }
    // Calculate previous period's surplus/deficit
    const previousAllocated = (_a = previousPeriod.modifiedAmount) !== null && _a !== void 0 ? _a : previousPeriod.allocatedAmount;
    const previousSpent = (_b = previousPeriod.spent) !== null && _b !== void 0 ? _b : 0;
    const previousRollover = (_c = previousPeriod.rolledOverAmount) !== null && _c !== void 0 ? _c : 0;
    // Effective budget = allocated + any rollover received
    const previousEffective = previousAllocated + previousRollover;
    // Surplus (positive) or deficit (negative)
    const surplusDeficit = previousEffective - previousSpent;
    // Also factor in any pending spread deduction from earlier periods
    const priorPendingDeduction = (_d = previousPeriod.pendingRolloverDeduction) !== null && _d !== void 0 ? _d : 0;
    const priorPendingPeriods = (_e = previousPeriod.pendingRolloverPeriods) !== null && _e !== void 0 ? _e : 0;
    let rolledOverAmount = 0;
    let pendingRolloverDeduction = 0;
    let pendingRolloverPeriods = 0;
    if (surplusDeficit >= 0) {
        // UNDERSPEND: Carry surplus forward
        rolledOverAmount = surplusDeficit;
        // If there was pending deduction, it's now cleared since we had surplus
        // (This is a simplification - could alternatively reduce surplus by pending amount)
    }
    else {
        // OVERSPEND: Handle based on strategy
        const deficit = Math.abs(surplusDeficit);
        if (rolloverSettings.strategy === 'immediate') {
            // Immediate: Take full hit in next period
            rolledOverAmount = -deficit;
        }
        else {
            // Spread: Distribute deficit across multiple periods
            const spreadPeriods = rolloverSettings.spreadPeriods;
            const perPeriodDeduction = Math.round((deficit / spreadPeriods) * 100) / 100;
            rolledOverAmount = -perPeriodDeduction;
            pendingRolloverDeduction = deficit - perPeriodDeduction;
            pendingRolloverPeriods = spreadPeriods - 1;
        }
    }
    // Add any continuing spread deduction from prior periods
    if (priorPendingPeriods > 0 && priorPendingDeduction > 0) {
        const perPeriodPriorDeduction = Math.round((priorPendingDeduction / priorPendingPeriods) * 100) / 100;
        rolledOverAmount -= perPeriodPriorDeduction;
        // Track remaining prior deduction
        if (priorPendingPeriods > 1) {
            pendingRolloverDeduction += (priorPendingDeduction - perPeriodPriorDeduction);
            pendingRolloverPeriods = Math.max(pendingRolloverPeriods, priorPendingPeriods - 1);
        }
    }
    return {
        rolledOverAmount: Math.round(rolledOverAmount * 100) / 100,
        rolledOverFromPeriodId: (_f = previousPeriod.id) !== null && _f !== void 0 ? _f : null,
        pendingRolloverDeduction: Math.round(pendingRolloverDeduction * 100) / 100,
        pendingRolloverPeriods,
    };
}
/**
 * Calculate the effective remaining amount for a period, including rollover.
 *
 * @param period - The budget period
 * @returns Effective remaining amount
 */
function calculateEffectiveRemaining(period) {
    var _a, _b, _c;
    const allocated = (_a = period.modifiedAmount) !== null && _a !== void 0 ? _a : period.allocatedAmount;
    const rollover = (_b = period.rolledOverAmount) !== null && _b !== void 0 ? _b : 0;
    const spent = (_c = period.spent) !== null && _c !== void 0 ? _c : 0;
    // Effective = allocated + rollover (can be negative for overspend)
    return Math.round((allocated + rollover - spent) * 100) / 100;
}
/**
 * Find the previous period of the same type for a given period.
 *
 * @param periods - Array of budget periods sorted by periodStart descending
 * @param currentPeriod - The current period
 * @returns The previous period of the same type, or null if none exists
 */
function findPreviousPeriodOfSameType(periods, currentPeriod) {
    const currentStart = currentPeriod.periodStart instanceof firestore_1.Timestamp
        ? currentPeriod.periodStart.toDate()
        : new Date(currentPeriod.periodStart);
    // Find periods of same type that end before current period starts
    const previousPeriods = periods.filter(p => {
        if (p.periodType !== currentPeriod.periodType)
            return false;
        if (p.id === currentPeriod.id)
            return false;
        const pEnd = p.periodEnd instanceof firestore_1.Timestamp
            ? p.periodEnd.toDate()
            : new Date(p.periodEnd);
        return pEnd < currentStart;
    });
    if (previousPeriods.length === 0)
        return null;
    // Return the most recent one (closest to current period)
    return previousPeriods.reduce((latest, p) => {
        const latestEnd = latest.periodEnd instanceof firestore_1.Timestamp
            ? latest.periodEnd.toDate()
            : new Date(latest.periodEnd);
        const pEnd = p.periodEnd instanceof firestore_1.Timestamp
            ? p.periodEnd.toDate()
            : new Date(p.periodEnd);
        return pEnd > latestEnd ? p : latest;
    });
}
/**
 * Check if a period is in the past (ended before today).
 *
 * @param period - The budget period
 * @returns True if the period has ended
 */
function isPeriodInPast(period) {
    const periodEnd = period.periodEnd instanceof firestore_1.Timestamp
        ? period.periodEnd.toDate()
        : new Date(period.periodEnd);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return periodEnd < today;
}
//# sourceMappingURL=rolloverCalculation.js.map