"use strict";
/**
 * @file budgetTestHelpers.ts
 * @description Helper utilities for budget period tests
 *
 * Provides:
 * - Mock source period creation
 * - Amount calculation verification
 * - Period boundary validation
 * - Sum tolerance checking
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.roundToCents = roundToCents;
exports.amountsEqual = amountsEqual;
exports.getDaysInMonth = getDaysInMonth;
exports.createTimestamp = createTimestamp;
exports.getDaysBetween = getDaysBetween;
exports.createMockSourcePeriod = createMockSourcePeriod;
exports.createMonthlySourcePeriods = createMonthlySourcePeriods;
exports.createBiMonthlySourcePeriods = createBiMonthlySourcePeriods;
exports.createWeeklySourcePeriods = createWeeklySourcePeriods;
exports.calculateExpectedAmount = calculateExpectedAmount;
exports.getMonthlyDailyRate = getMonthlyDailyRate;
exports.getBiMonthlyDailyRate = getBiMonthlyDailyRate;
exports.calculatePeriodTypeTotals = calculatePeriodTypeTotals;
exports.validatePeriodTotalsMatch = validatePeriodTotalsMatch;
exports.createMockBudget = createMockBudget;
exports.createExample1Scenario = createExample1Scenario;
exports.createExample2Scenario = createExample2Scenario;
exports.createLeapYearScenario = createLeapYearScenario;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../../types");
// ============================================================================
// ROUNDING UTILITIES
// ============================================================================
/**
 * Round to 2 decimal places (standard currency rounding)
 * Uses banker's rounding (round half to even) for consistency
 */
function roundToCents(value) {
    return Math.round(value * 100) / 100;
}
/**
 * Check if two amounts are equal within tolerance (±$0.01)
 */
function amountsEqual(a, b, tolerance = 0.01) {
    return Math.abs(a - b) <= tolerance;
}
// ============================================================================
// DATE UTILITIES
// ============================================================================
/**
 * Get number of days in a specific month
 */
function getDaysInMonth(year, month) {
    // Month is 0-indexed (0 = January, 11 = December)
    return new Date(year, month + 1, 0).getDate();
}
/**
 * Create a Timestamp from year, month, day
 */
function createTimestamp(year, month, day) {
    return firestore_1.Timestamp.fromDate(new Date(year, month - 1, day, 0, 0, 0, 0));
}
/**
 * Get days between two timestamps (inclusive)
 * Note: Uses Math.round to handle floating-point precision issues from timezone conversions
 */
function getDaysBetween(start, end) {
    const startMs = start.toMillis();
    const endMs = end.toMillis();
    const daysDiff = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24));
    return daysDiff + 1; // +1 because both start and end dates are inclusive
}
/**
 * Create a mock SourcePeriod for testing
 */
function createMockSourcePeriod(options) {
    const { type, year, month, weekNumber, biMonthlyHalf, startDate, endDate } = options;
    let periodId;
    if (type === types_1.PeriodType.MONTHLY) {
        periodId = options.id || `${year}-M${String(month).padStart(2, '0')}`;
    }
    else if (type === types_1.PeriodType.BI_MONTHLY) {
        periodId = options.id || `${year}-BM${String(month).padStart(2, '0')}-${biMonthlyHalf}`;
    }
    else {
        periodId = options.id || `${year}-W${String(weekNumber).padStart(2, '0')}`;
    }
    return {
        id: periodId,
        periodId,
        type,
        startDate,
        endDate,
        year,
        index: weekNumber || month || 1,
        isCurrent: false,
        metadata: {
            month,
            weekNumber,
            biMonthlyHalf,
            weekStartDay: 0, // Sunday
        },
    };
}
/**
 * Create monthly source periods for a given year range
 */
function createMonthlySourcePeriods(startYear, startMonth, endYear, endMonth) {
    const periods = [];
    let year = startYear;
    let month = startMonth;
    while (year < endYear || (year === endYear && month <= endMonth)) {
        const daysInMonth = getDaysInMonth(year, month - 1);
        const startDate = createTimestamp(year, month, 1);
        const endDate = createTimestamp(year, month, daysInMonth);
        periods.push(createMockSourcePeriod({
            type: types_1.PeriodType.MONTHLY,
            year,
            month,
            startDate,
            endDate,
        }));
        month++;
        if (month > 12) {
            month = 1;
            year++;
        }
    }
    return periods;
}
/**
 * Create bi-monthly source periods for a given year range
 */
function createBiMonthlySourcePeriods(startYear, startMonth, endYear, endMonth) {
    const periods = [];
    let year = startYear;
    let month = startMonth;
    while (year < endYear || (year === endYear && month <= endMonth)) {
        const daysInMonth = getDaysInMonth(year, month - 1);
        // First half: 1-15
        periods.push(createMockSourcePeriod({
            type: types_1.PeriodType.BI_MONTHLY,
            year,
            month,
            biMonthlyHalf: 1,
            startDate: createTimestamp(year, month, 1),
            endDate: createTimestamp(year, month, 15),
        }));
        // Second half: 16-end
        periods.push(createMockSourcePeriod({
            type: types_1.PeriodType.BI_MONTHLY,
            year,
            month,
            biMonthlyHalf: 2,
            startDate: createTimestamp(year, month, 16),
            endDate: createTimestamp(year, month, daysInMonth),
        }));
        month++;
        if (month > 12) {
            month = 1;
            year++;
        }
    }
    return periods;
}
/**
 * Create weekly source periods for a given date range
 * Note: Weeks start on Sunday (US standard)
 */
function createWeeklySourcePeriods(startDate, endDate) {
    const periods = [];
    // Find the first Sunday on or before startDate
    const currentDate = new Date(startDate);
    const dayOfWeek = currentDate.getDay();
    if (dayOfWeek !== 0) {
        currentDate.setDate(currentDate.getDate() - dayOfWeek);
    }
    let weekNumber = 1;
    const startYear = currentDate.getFullYear();
    while (currentDate <= endDate) {
        const weekStart = new Date(currentDate);
        const weekEnd = new Date(currentDate);
        weekEnd.setDate(weekEnd.getDate() + 6);
        // Clip week boundaries to budget date range
        // This ensures weeks don't include days outside the budget period
        const actualStartDate = weekStart < startDate ? startDate : weekStart;
        const actualEndDate = weekEnd > endDate ? endDate : weekEnd;
        // Only add period if it has valid dates within range
        if (actualStartDate <= actualEndDate) {
            periods.push(createMockSourcePeriod({
                type: types_1.PeriodType.WEEKLY,
                year: actualStartDate.getFullYear(),
                weekNumber,
                startDate: firestore_1.Timestamp.fromDate(actualStartDate),
                endDate: firestore_1.Timestamp.fromDate(actualEndDate),
            }));
        }
        // Move to next week
        currentDate.setDate(currentDate.getDate() + 7);
        weekNumber++;
        // Reset week number for new year
        if (currentDate.getFullYear() > startYear) {
            weekNumber = 1;
        }
    }
    return periods;
}
// ============================================================================
// AMOUNT CALCULATION HELPERS
// ============================================================================
/**
 * Calculate the expected amount for a period using day-by-day calculation
 * This mirrors the actual implementation logic for validation
 */
function calculateExpectedAmount(budgetAmount, budgetPeriodType, targetPeriod) {
    var _a, _b;
    const startDate = targetPeriod.startDate.toDate();
    const endDate = targetPeriod.endDate.toDate();
    // Same type = same amount
    if (budgetPeriodType === targetPeriod.type) {
        return budgetAmount;
    }
    let totalAllocation = 0;
    if (budgetPeriodType === types_1.PeriodType.MONTHLY) {
        // Day-by-day iteration for monthly budgets
        const currentDate = new Date(startDate);
        while (currentDate <= endDate) {
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth();
            const daysInCurrentMonth = getDaysInMonth(year, month);
            const dailyRateForMonth = budgetAmount / daysInCurrentMonth;
            totalAllocation += dailyRateForMonth;
            currentDate.setDate(currentDate.getDate() + 1);
        }
    }
    else if (budgetPeriodType === types_1.PeriodType.BI_MONTHLY) {
        // Bi-monthly: use days in bi-monthly period
        const biMonthlyDays = ((_a = targetPeriod.metadata) === null || _a === void 0 ? void 0 : _a.biMonthlyHalf) === 1
            ? 15
            : getDaysInMonth(targetPeriod.year, (((_b = targetPeriod.metadata) === null || _b === void 0 ? void 0 : _b.month) || 1) - 1) - 15;
        const dailyRate = budgetAmount / biMonthlyDays;
        const targetDays = getDaysBetween(targetPeriod.startDate, targetPeriod.endDate);
        totalAllocation = dailyRate * targetDays;
    }
    else if (budgetPeriodType === types_1.PeriodType.WEEKLY) {
        // Weekly: divide by 7
        const dailyRate = budgetAmount / 7;
        const targetDays = getDaysBetween(targetPeriod.startDate, targetPeriod.endDate);
        totalAllocation = dailyRate * targetDays;
    }
    return roundToCents(totalAllocation);
}
/**
 * Calculate daily rate for a month from a monthly budget
 */
function getMonthlyDailyRate(monthlyAmount, year, month) {
    const daysInMonth = getDaysInMonth(year, month - 1);
    return roundToCents(monthlyAmount / daysInMonth);
}
/**
 * Calculate daily rate for a bi-monthly period
 */
function getBiMonthlyDailyRate(biMonthlyAmount, year, month, half) {
    const daysInMonth = getDaysInMonth(year, month - 1);
    const periodDays = half === 1 ? 15 : daysInMonth - 15;
    return roundToCents(biMonthlyAmount / periodDays);
}
/**
 * Calculate total amounts for each period type
 * Returns summaries for validation that all period types sum to same total
 */
function calculatePeriodTypeTotals(budgetAmount, budgetPeriodType, monthlyPeriods, biMonthlyPeriods, weeklyPeriods) {
    const calculateSummary = (periods, type) => {
        let totalAmount = 0;
        const periodDetails = [];
        for (const period of periods) {
            const amount = calculateExpectedAmount(budgetAmount, budgetPeriodType, period);
            const days = getDaysBetween(period.startDate, period.endDate);
            totalAmount += amount;
            periodDetails.push({
                periodId: period.id || period.periodId,
                amount,
                days,
            });
        }
        return {
            periodType: type,
            totalAmount: roundToCents(totalAmount),
            periodCount: periods.length,
            periods: periodDetails,
        };
    };
    return {
        monthly: calculateSummary(monthlyPeriods, types_1.PeriodType.MONTHLY),
        biMonthly: calculateSummary(biMonthlyPeriods, types_1.PeriodType.BI_MONTHLY),
        weekly: calculateSummary(weeklyPeriods, types_1.PeriodType.WEEKLY),
    };
}
/**
 * Validate that all period type totals are equal within tolerance
 */
function validatePeriodTotalsMatch(summaries, tolerance = 0.01) {
    const { monthly, biMonthly, weekly } = summaries;
    const monthlyTotal = monthly.totalAmount;
    const biMonthlyTotal = biMonthly.totalAmount;
    const weeklyTotal = weekly.totalAmount;
    const differences = [
        Math.abs(monthlyTotal - biMonthlyTotal),
        Math.abs(monthlyTotal - weeklyTotal),
        Math.abs(biMonthlyTotal - weeklyTotal),
    ];
    const maxDifference = Math.max(...differences);
    const isValid = maxDifference <= tolerance;
    return {
        isValid,
        monthlyTotal,
        biMonthlyTotal,
        weeklyTotal,
        maxDifference,
        details: `Monthly: $${monthlyTotal.toFixed(2)}, Bi-Monthly: $${biMonthlyTotal.toFixed(2)}, Weekly: $${weeklyTotal.toFixed(2)}, Max Diff: $${maxDifference.toFixed(2)}`,
    };
}
/**
 * Create a mock Budget for testing
 */
function createMockBudget(options) {
    const now = firestore_1.Timestamp.now();
    const userId = options.userId || 'test_user_001';
    return {
        id: options.id || `budget_${Date.now()}`,
        name: options.name || 'Test Budget',
        description: 'Test budget for unit tests',
        amount: options.amount,
        currency: 'USD',
        categoryIds: options.categoryIds || ['test_category'],
        period: options.period,
        budgetType: 'recurring',
        isOngoing: true,
        startDate: options.startDate,
        endDate: options.endDate || options.startDate,
        spent: 0,
        remaining: options.amount,
        alertThreshold: 80,
        memberIds: [userId],
        isShared: false,
        isActive: true,
        createdBy: userId,
        ownerId: userId,
        createdAt: now,
        updatedAt: now,
        access: {
            createdBy: userId,
            ownerId: userId,
            isPrivate: true,
        },
    };
}
// ============================================================================
// TEST SCENARIOS
// ============================================================================
/**
 * User's Example 1: Monthly budget $100 from Feb 1 - March 19
 * Feb: 28 days, $3.57/day
 * March: 31 days, $3.23/day
 */
function createExample1Scenario() {
    const startDate = new Date(2025, 1, 1); // Feb 1
    const endDate = new Date(2025, 2, 19); // March 19
    return {
        budgetAmount: 100,
        budgetPeriodType: types_1.PeriodType.MONTHLY,
        startDate,
        endDate,
        febDailyRate: roundToCents(100 / 28), // $3.57
        marchDailyRate: roundToCents(100 / 31), // $3.23
        expectedWeeklyPeriods: [
            { dates: 'Feb 1-7', days: 7, expectedAmount: roundToCents(7 * (100 / 28)) }, // $24.99
            { dates: 'Feb 8-14', days: 7, expectedAmount: roundToCents(7 * (100 / 28)) }, // $24.99
            { dates: 'Feb 15-21', days: 7, expectedAmount: roundToCents(7 * (100 / 28)) }, // $24.99
            { dates: 'Feb 22-28', days: 7, expectedAmount: roundToCents(7 * (100 / 28)) }, // $24.99
            { dates: 'Mar 1-7', days: 7, expectedAmount: roundToCents(7 * (100 / 31)) }, // $22.58
            { dates: 'Mar 8-14', days: 7, expectedAmount: roundToCents(7 * (100 / 31)) }, // $22.58
            { dates: 'Mar 15-19', days: 5, expectedAmount: roundToCents(5 * (100 / 31)) }, // $16.13
        ],
        // Total: $100 (Feb) + $61.29 (19 days in March) = $161.29
        expectedTotal: roundToCents(100 + 19 * (100 / 31)),
    };
}
/**
 * User's Example 2: Bi-monthly budget $100/bi-monthly from Feb 1 - April 13
 */
function createExample2Scenario() {
    const startDate = new Date(2025, 1, 1); // Feb 1
    const endDate = new Date(2025, 3, 13); // April 13
    // Calculate totals based on bi-monthly periods
    // Feb: 2 bi-monthly periods = $200
    // March: 2 bi-monthly periods = $200
    // April 1-13: partial (13 days out of 15 in first half) = $86.67
    const aprilPartialAmount = roundToCents(100 * (13 / 15));
    return {
        budgetAmount: 100,
        budgetPeriodType: types_1.PeriodType.BI_MONTHLY,
        startDate,
        endDate,
        expectedBiMonthlyPeriods: [
            { dates: 'Feb 1-15', days: 15, expectedAmount: 100 },
            { dates: 'Feb 16-28', days: 13, expectedAmount: 100 },
            { dates: 'Mar 1-15', days: 15, expectedAmount: 100 },
            { dates: 'Mar 16-31', days: 16, expectedAmount: 100 },
            { dates: 'Apr 1-13', days: 13, expectedAmount: aprilPartialAmount }, // $86.67
        ],
        expectedMonthlyPeriods: [
            { dates: 'Feb', days: 28, expectedAmount: 200 },
            { dates: 'Mar', days: 31, expectedAmount: 200 },
            { dates: 'Apr 1-13', days: 13, expectedAmount: aprilPartialAmount },
        ],
        expectedTotal: roundToCents(400 + aprilPartialAmount), // $486.67
    };
}
/**
 * Leap year February scenario for edge case testing
 */
function createLeapYearScenario() {
    // 2024 is a leap year (Feb has 29 days)
    return {
        budgetAmount: 100,
        year: 2024,
        month: 2, // February
        startDate: new Date(2024, 1, 1), // Feb 1
        endDate: new Date(2024, 1, 29), // Feb 29
        daysInFeb: 29,
        dailyRate: roundToCents(100 / 29), // $3.45
        firstHalfDays: 15,
        secondHalfDays: 14, // 29 - 15 = 14
    };
}
//# sourceMappingURL=budgetTestHelpers.js.map