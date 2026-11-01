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
exports.rolloverPauseOf = rolloverPauseOf;
exports.calculateRolloverForPeriod = calculateRolloverForPeriod;
exports.calculateEffectiveRemaining = calculateEffectiveRemaining;
exports.findPreviousPeriodOfSameType = findPreviousPeriodOfSameType;
exports.isPeriodInPast = isPeriodInPast;
const period_override_service_1 = require("../../domain/budgets/period_override.service");
const period_allocation_view_service_1 = require("../../domain/budgets/period_allocation_view.service");
const budget_pause_service_1 = require("../../domain/budgets/budget_pause.service");
const match_budgets_service_1 = require("../../domain/budgets/match_budgets.service");
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
        strategy: "spread",
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
/** The budget doc's pause (stored "YYYY-MM-DD" ranges) + pricing, or undefined if never paused. */
function rolloverPauseOf(budget) {
    const raw = budget.pausedRanges;
    if (!Array.isArray(raw) || raw.length === 0)
        return undefined;
    const ranges = [];
    for (const r of raw) {
        const a = typeof (r === null || r === void 0 ? void 0 : r.start) === "string" ? (0, budget_pause_service_1.day_from_iso)(r.start) : null;
        const b = typeof (r === null || r === void 0 ? void 0 : r.end) === "string" ? (0, budget_pause_service_1.day_from_iso)(r.end) : null;
        if (a !== null && b !== null && b >= a)
            ranges.push({ start_day: a, end_day: b });
    }
    if (ranges.length === 0)
        return undefined;
    const b = budget;
    const priced = b.startDate
        ? (() => {
            var _a, _b, _c, _d, _e;
            const mi = (0, match_budgets_service_1.budget_to_match_input)({
                id: b.id, name: (_a = b.name) !== null && _a !== void 0 ? _a : "", period: (_b = b.period) !== null && _b !== void 0 ? _b : "monthly", start_date: b.startDate,
                end_date: (_c = b.endDate) !== null && _c !== void 0 ? _c : null, budget_end_date: (_d = b.budgetEndDate) !== null && _d !== void 0 ? _d : null, is_ongoing: (_e = b.isOngoing) !== null && _e !== void 0 ? _e : true,
            });
            return (0, match_budgets_service_1.budget_priced_range)(mi.start_ms, mi.cadence, mi.is_ongoing, mi.end_ms);
        })()
        : undefined;
    return { ranges: (0, budget_pause_service_1.normalize_paused_ranges)(ranges), priced };
}
/**
 * The previous period's effective amount AS THE PAGE SHOWS IT when part of it is paused: only
 * its unpaused days' share of the base, its "This Period Only" adjustments and its rollover-in
 * (the same `bucket_allocation_unpaused` the page uses). Null when no paused day falls in it.
 */
function pausedPeriodEffective(period, pause) {
    var _a, _b, _c, _d;
    if (!pause)
        return null;
    const start = toMs(period.periodStart);
    const end = toMs(period.periodEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end))
        return null;
    if ((0, budget_pause_service_1.paused_days_in)(pause.ranges, start, end) === 0)
        return null;
    const base = (_b = (_a = (0, period_override_service_1.direct_period_override)(period)) !== null && _a !== void 0 ? _a : period.allocatedAmount) !== null && _b !== void 0 ? _b : 0;
    const raw = (_c = period.periodAdjustments) !== null && _c !== void 0 ? _c : [];
    const adjustments = raw
        .filter((a) => typeof (a === null || a === void 0 ? void 0 : a.periodId) === "string" && typeof a.startMs === "number" &&
        typeof a.endMs === "number" && typeof a.amount === "number")
        .map((a) => ({ period_id: a.periodId, start_ms: a.startMs, end_ms: a.endMs, amount: a.amount }));
    return (0, period_allocation_view_service_1.bucket_allocation_unpaused)([{
            allocated_amount: base,
            effective_amount: base + ((_d = period.rolledOverAmount) !== null && _d !== void 0 ? _d : 0),
            adjustments,
            start_ms: start,
            end_ms: end,
        }], start, end, pause.priced, pause.ranges).effective;
}
function calculateRolloverForPeriod(currentPeriod, previousPeriod, rolloverSettings, nowMs = Date.now(), pause) {
    var _a, _b, _c, _d, _e, _f;
    // No rollover if disabled, no previous period, or the previous period hasn't ended yet
    if (!rolloverSettings.enabled || !previousPeriod || !periodEndedBy(previousPeriod, nowMs)) {
        return {
            rolledOverAmount: 0,
            rolledOverFromPeriodId: null,
            pendingRolloverDeduction: 0,
            pendingRolloverPeriods: 0,
        };
    }
    // Calculate previous period's surplus/deficit
    // "This Period Only" counts only when set directly on the budget's own period (not a synced
    // copy).
    const previousAllocated = (0, period_override_service_1.period_allocation)(previousPeriod);
    const previousSpent = (_a = previousPeriod.spent) !== null && _a !== void 0 ? _a : 0;
    const previousRollover = (_b = previousPeriod.rolledOverAmount) !== null && _b !== void 0 ? _b : 0;
    // Effective budget = allocated + any rollover received. With paused days in it (PZ6): only the
    // unpaused share, exactly as its page shows it — its stored `spent` already leaves them out.
    const previousEffective = (_c = pausedPeriodEffective(previousPeriod, pause)) !== null && _c !== void 0 ? _c : previousAllocated + previousRollover;
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
        if (rolloverSettings.strategy === "immediate") {
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
/** A period bound as epoch ms (Timestamp, Date, or anything Date accepts). */
function toMs(v) {
    return v instanceof firestore_1.Timestamp
        ? v.toMillis()
        : v && typeof v.toMillis === "function"
            ? v.toMillis()
            : new Date(v).getTime();
}
/** True when the period's last moment is before `nowMs`. */
function periodEndedBy(period, nowMs) {
    const end = period.periodEnd;
    const endMs = end instanceof firestore_1.Timestamp
        ? end.toMillis()
        : end && typeof end.toMillis === "function"
            ? end.toMillis()
            : new Date(end).getTime();
    return Number.isFinite(endMs) && endMs < nowMs;
}
/**
 * Calculate the effective remaining amount for a period, including rollover.
 *
 * @param period - The budget period
 * @returns Effective remaining amount
 */
function calculateEffectiveRemaining(period) {
    var _a, _b;
    const allocated = (0, period_override_service_1.period_allocation)(period);
    const rollover = (_a = period.rolledOverAmount) !== null && _a !== void 0 ? _a : 0;
    const spent = (_b = period.spent) !== null && _b !== void 0 ? _b : 0;
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