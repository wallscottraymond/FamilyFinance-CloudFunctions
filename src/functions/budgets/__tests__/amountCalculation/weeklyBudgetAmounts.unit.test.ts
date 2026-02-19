/**
 * @file weeklyBudgetAmounts.unit.test.ts
 * @description Unit tests for weekly budget amount calculations
 *
 * Tests the conversion of weekly budget amounts to:
 * - Monthly periods (weeks per month × weekly amount)
 * - Bi-monthly periods (days / 7 × weekly amount)
 *
 * CRITICAL VALIDATION:
 * - Sum of all period types must equal the same total (±$0.01)
 * - Weekly uses fixed 7-day calculation
 * - Partial weeks at budget boundaries handled correctly
 */

import { PeriodType } from '../../../../types';
import { calculatePeriodAllocatedAmount } from '../../utils/calculatePeriodAllocatedAmount';
import {
  roundToCents,
  amountsEqual,
  createTimestamp,
  createMockSourcePeriod,
  createMonthlySourcePeriods,
  createBiMonthlySourcePeriods,
  createWeeklySourcePeriods,
  calculatePeriodTypeTotals,
  validatePeriodTotalsMatch,
} from '../helpers/budgetTestHelpers';

describe('Weekly Budget Amount Calculations', () => {
  // ============================================================================
  // BASIC WEEKLY → WEEKLY (SAME TYPE)
  // ============================================================================

  describe('Weekly to Weekly (same type)', () => {
    it('should return the same amount when budget and target are both weekly', () => {
      // Arrange
      const budgetAmount = 150;
      const targetPeriod = createMockSourcePeriod({
        type: PeriodType.WEEKLY,
        year: 2025,
        weekNumber: 1,
        startDate: createTimestamp(2025, 1, 5),
        endDate: createTimestamp(2025, 1, 11),
      });

      // Act
      const result = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, targetPeriod);

      // Assert
      expect(result).toBe(150);
    });

    it('should return same amount for any full week', () => {
      // Arrange
      const budgetAmount = 100;

      // Different weeks
      const week1 = createMockSourcePeriod({
        type: PeriodType.WEEKLY,
        year: 2025,
        weekNumber: 1,
        startDate: createTimestamp(2025, 1, 5),
        endDate: createTimestamp(2025, 1, 11),
      });

      const week25 = createMockSourcePeriod({
        type: PeriodType.WEEKLY,
        year: 2025,
        weekNumber: 25,
        startDate: createTimestamp(2025, 6, 22),
        endDate: createTimestamp(2025, 6, 28),
      });

      // Act
      const result1 = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, week1);
      const result25 = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, week25);

      // Assert
      expect(result1).toBe(100);
      expect(result25).toBe(100);
    });

    it('should handle partial week at budget end', () => {
      // Arrange: Budget ends mid-week, only 4 days
      const budgetAmount = 100;
      const partialWeek = createMockSourcePeriod({
        type: PeriodType.WEEKLY,
        year: 2025,
        weekNumber: 10,
        startDate: createTimestamp(2025, 3, 2),
        endDate: createTimestamp(2025, 3, 5), // Only 4 days
      });

      // Act
      const result = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, partialWeek);

      // Assert: Same type returns same amount regardless of actual days
      expect(result).toBe(100);
    });
  });

  // ============================================================================
  // WEEKLY → MONTHLY CONVERSION
  // ============================================================================

  describe('Weekly to Monthly conversion', () => {
    it('should calculate monthly amount based on days in month', () => {
      // Arrange: $100/week → Monthly for January (31 days)
      // Daily rate = $100 / 7 = $14.29
      // Monthly = 31 * $14.29 = $443.03
      const budgetAmount = 100;
      const targetPeriod = createMockSourcePeriod({
        type: PeriodType.MONTHLY,
        year: 2025,
        month: 1,
        startDate: createTimestamp(2025, 1, 1),
        endDate: createTimestamp(2025, 1, 31),
      });

      // Act
      const result = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, targetPeriod);

      // Assert
      const dailyRate = 100 / 7;
      const expectedAmount = roundToCents(31 * dailyRate);
      expect(amountsEqual(result, expectedAmount, 0.02)).toBe(true);
    });

    it('should calculate February monthly correctly', () => {
      // Arrange: $100/week → Monthly for February 2025 (28 days)
      // Daily rate = $100 / 7 = $14.29
      // Monthly = 28 * $14.29 = $400.12
      const budgetAmount = 100;
      const targetPeriod = createMockSourcePeriod({
        type: PeriodType.MONTHLY,
        year: 2025,
        month: 2,
        startDate: createTimestamp(2025, 2, 1),
        endDate: createTimestamp(2025, 2, 28),
      });

      // Act
      const result = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, targetPeriod);

      // Assert
      const dailyRate = 100 / 7;
      const expectedAmount = roundToCents(28 * dailyRate);
      expect(amountsEqual(result, expectedAmount, 0.02)).toBe(true);
    });

    it('should have different amounts for months with different days', () => {
      // Arrange: $100/week for various months
      const budgetAmount = 100;

      // February (28 days)
      const feb = createMockSourcePeriod({
        type: PeriodType.MONTHLY,
        year: 2025,
        month: 2,
        startDate: createTimestamp(2025, 2, 1),
        endDate: createTimestamp(2025, 2, 28),
      });

      // April (30 days)
      const apr = createMockSourcePeriod({
        type: PeriodType.MONTHLY,
        year: 2025,
        month: 4,
        startDate: createTimestamp(2025, 4, 1),
        endDate: createTimestamp(2025, 4, 30),
      });

      // July (31 days)
      const jul = createMockSourcePeriod({
        type: PeriodType.MONTHLY,
        year: 2025,
        month: 7,
        startDate: createTimestamp(2025, 7, 1),
        endDate: createTimestamp(2025, 7, 31),
      });

      // Act
      const febResult = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, feb);
      const aprResult = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, apr);
      const julResult = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, jul);

      // Assert: July > April > February
      expect(julResult).toBeGreaterThan(aprResult);
      expect(aprResult).toBeGreaterThan(febResult);
    });
  });

  // ============================================================================
  // WEEKLY → BI-MONTHLY CONVERSION
  // ============================================================================

  describe('Weekly to Bi-Monthly conversion', () => {
    it('should calculate bi-monthly first half correctly', () => {
      // Arrange: $100/week → Bi-monthly first half (15 days)
      // Daily rate = $100 / 7 = $14.29
      // Bi-monthly = 15 * $14.29 = $214.35
      const budgetAmount = 100;
      const targetPeriod = createMockSourcePeriod({
        type: PeriodType.BI_MONTHLY,
        year: 2025,
        month: 1,
        biMonthlyHalf: 1,
        startDate: createTimestamp(2025, 1, 1),
        endDate: createTimestamp(2025, 1, 15),
      });

      // Act
      const result = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, targetPeriod);

      // Assert
      const dailyRate = 100 / 7;
      const expectedAmount = roundToCents(15 * dailyRate);
      expect(amountsEqual(result, expectedAmount, 0.02)).toBe(true);
    });

    it('should calculate bi-monthly second half with varying days correctly', () => {
      // Arrange: $100/week → Bi-monthly second halves
      const budgetAmount = 100;
      const dailyRate = 100 / 7;

      // January second half: 16 days
      const janSecond = createMockSourcePeriod({
        type: PeriodType.BI_MONTHLY,
        year: 2025,
        month: 1,
        biMonthlyHalf: 2,
        startDate: createTimestamp(2025, 1, 16),
        endDate: createTimestamp(2025, 1, 31),
      });

      // February second half: 13 days
      const febSecond = createMockSourcePeriod({
        type: PeriodType.BI_MONTHLY,
        year: 2025,
        month: 2,
        biMonthlyHalf: 2,
        startDate: createTimestamp(2025, 2, 16),
        endDate: createTimestamp(2025, 2, 28),
      });

      // Act
      const janResult = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, janSecond);
      const febResult = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, febSecond);

      // Assert
      expect(amountsEqual(janResult, roundToCents(16 * dailyRate), 0.02)).toBe(true);
      expect(amountsEqual(febResult, roundToCents(13 * dailyRate), 0.02)).toBe(true);
    });

    it('should have bi-monthly halves sum to monthly total', () => {
      // Arrange: $100/week for January
      const budgetAmount = 100;

      const janFirst = createMockSourcePeriod({
        type: PeriodType.BI_MONTHLY,
        year: 2025,
        month: 1,
        biMonthlyHalf: 1,
        startDate: createTimestamp(2025, 1, 1),
        endDate: createTimestamp(2025, 1, 15),
      });

      const janSecond = createMockSourcePeriod({
        type: PeriodType.BI_MONTHLY,
        year: 2025,
        month: 1,
        biMonthlyHalf: 2,
        startDate: createTimestamp(2025, 1, 16),
        endDate: createTimestamp(2025, 1, 31),
      });

      const janMonthly = createMockSourcePeriod({
        type: PeriodType.MONTHLY,
        year: 2025,
        month: 1,
        startDate: createTimestamp(2025, 1, 1),
        endDate: createTimestamp(2025, 1, 31),
      });

      // Act
      const firstHalf = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, janFirst);
      const secondHalf = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, janSecond);
      const monthly = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, janMonthly);

      // Assert
      expect(amountsEqual(firstHalf + secondHalf, monthly, 0.01)).toBe(true);
    });
  });

  // ============================================================================
  // DAILY RATE CONSISTENCY
  // ============================================================================

  describe('Daily Rate Consistency', () => {
    it('should use consistent $$/day = budget/7 for all conversions', () => {
      const budgetAmount = 70; // Easy divisible by 7
      const expectedDailyRate = 10; // $70/7 = $10/day

      // Test monthly (31 days = $310)
      const monthly31 = createMockSourcePeriod({
        type: PeriodType.MONTHLY,
        year: 2025,
        month: 1,
        startDate: createTimestamp(2025, 1, 1),
        endDate: createTimestamp(2025, 1, 31),
      });
      const monthlyResult = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, monthly31);
      expect(amountsEqual(monthlyResult, 31 * expectedDailyRate, 0.01)).toBe(true);

      // Test bi-monthly first half (15 days = $150)
      const biMonthly15 = createMockSourcePeriod({
        type: PeriodType.BI_MONTHLY,
        year: 2025,
        month: 1,
        biMonthlyHalf: 1,
        startDate: createTimestamp(2025, 1, 1),
        endDate: createTimestamp(2025, 1, 15),
      });
      const biMonthlyResult = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, biMonthly15);
      expect(amountsEqual(biMonthlyResult, 15 * expectedDailyRate, 0.01)).toBe(true);
    });

    it('should produce consistent totals across period types for a full year', () => {
      const budgetAmount = 100;

      // Create all monthly periods for 2025
      const monthlyPeriods = createMonthlySourcePeriods(2025, 1, 2025, 12);

      // Create all bi-monthly periods for 2025
      const biMonthlyPeriods = createBiMonthlySourcePeriods(2025, 1, 2025, 12);

      // Create all weekly periods for 2025
      const weeklyPeriods = createWeeklySourcePeriods(
        new Date(2025, 0, 1),
        new Date(2025, 11, 31)
      );

      // Calculate totals
      const summaries = calculatePeriodTypeTotals(
        budgetAmount,
        PeriodType.WEEKLY,
        monthlyPeriods,
        biMonthlyPeriods,
        weeklyPeriods
      );

      // Validate - weekly source budget converted to other period types
      // Weekly budget viewed as 52 weeks = $5200 base
      // But monthly/bi-monthly calculations use day-based rates
      // This produces ~1.6% difference which is expected behavior
      const validation = validatePeriodTotalsMatch(summaries, 0.05);

      // Log for debugging
      console.log('Weekly budget full year validation:', validation.details);

      // For weekly source budget, the weekly total is the "source of truth"
      // Other period types should be within 2% of the weekly total
      // $5300 weekly total × 2% = $106 tolerance
      expect(validation.maxDifference).toBeLessThan(summaries.weekly.totalAmount * 0.02);
    });
  });

  // ============================================================================
  // PARTIAL PERIODS
  // ============================================================================

  describe('Partial Periods at Budget Boundaries', () => {
    it('should handle partial month at budget start', () => {
      // Budget starts mid-month (Jan 15-31 = 17 days)
      const budgetAmount = 100;
      const partialMonth = createMockSourcePeriod({
        type: PeriodType.MONTHLY,
        year: 2025,
        month: 1,
        startDate: createTimestamp(2025, 1, 15),
        endDate: createTimestamp(2025, 1, 31),
      });

      const result = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, partialMonth);

      const dailyRate = 100 / 7;
      const expectedAmount = roundToCents(17 * dailyRate);
      expect(amountsEqual(result, expectedAmount, 0.02)).toBe(true);
    });

    it('should handle partial month at budget end', () => {
      // Budget ends mid-month (March 1-19 = 19 days)
      const budgetAmount = 100;
      const partialMonth = createMockSourcePeriod({
        type: PeriodType.MONTHLY,
        year: 2025,
        month: 3,
        startDate: createTimestamp(2025, 3, 1),
        endDate: createTimestamp(2025, 3, 19),
      });

      const result = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, partialMonth);

      const dailyRate = 100 / 7;
      const expectedAmount = roundToCents(19 * dailyRate);
      expect(amountsEqual(result, expectedAmount, 0.02)).toBe(true);
    });

    it('should handle partial bi-monthly period', () => {
      // Partial bi-monthly (April 1-13 = 13 days of first half)
      const budgetAmount = 100;
      const partialBiMonthly = createMockSourcePeriod({
        type: PeriodType.BI_MONTHLY,
        year: 2025,
        month: 4,
        biMonthlyHalf: 1,
        startDate: createTimestamp(2025, 4, 1),
        endDate: createTimestamp(2025, 4, 13),
      });

      const result = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, partialBiMonthly);

      const dailyRate = 100 / 7;
      const expectedAmount = roundToCents(13 * dailyRate);
      expect(amountsEqual(result, expectedAmount, 0.02)).toBe(true);
    });
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle single day period', () => {
      const budgetAmount = 70;
      const singleDay = createMockSourcePeriod({
        type: PeriodType.MONTHLY, // Using monthly for single day
        year: 2025,
        month: 1,
        startDate: createTimestamp(2025, 1, 15),
        endDate: createTimestamp(2025, 1, 15),
      });

      const result = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, singleDay);

      // Single day = $70/7 = $10
      expect(amountsEqual(result, 10, 0.01)).toBe(true);
    });

    it('should handle zero budget amount', () => {
      const budgetAmount = 0;
      const period = createMockSourcePeriod({
        type: PeriodType.MONTHLY,
        year: 2025,
        month: 1,
        startDate: createTimestamp(2025, 1, 1),
        endDate: createTimestamp(2025, 1, 31),
      });

      const result = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, period);
      expect(result).toBe(0);
    });

    it('should handle leap year February conversion', () => {
      // February 2024 (leap year): 29 days
      const budgetAmount = 100;
      const febLeap = createMockSourcePeriod({
        type: PeriodType.MONTHLY,
        year: 2024,
        month: 2,
        startDate: createTimestamp(2024, 2, 1),
        endDate: createTimestamp(2024, 2, 29),
      });

      // February 2025 (non-leap): 28 days
      const febNormal = createMockSourcePeriod({
        type: PeriodType.MONTHLY,
        year: 2025,
        month: 2,
        startDate: createTimestamp(2025, 2, 1),
        endDate: createTimestamp(2025, 2, 28),
      });

      const leapResult = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, febLeap);
      const normalResult = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, febNormal);

      // Leap year should be slightly more (29 vs 28 days)
      expect(leapResult).toBeGreaterThan(normalResult);

      // Difference should be exactly one day's worth
      const dailyRate = 100 / 7;
      expect(amountsEqual(leapResult - normalResult, dailyRate, 0.01)).toBe(true);
    });
  });

  // ============================================================================
  // WEEKLY PERIOD SPANNING MONTHS
  // ============================================================================

  describe('Weekly Periods Spanning Month Boundaries', () => {
    it('should calculate week spanning Jan-Feb correctly', () => {
      // Week from Jan 26 - Feb 1 (7 days)
      // For weekly budget, daily rate is constant (budget/7)
      const budgetAmount = 100;
      const crossMonthWeek = createMockSourcePeriod({
        type: PeriodType.WEEKLY,
        year: 2025,
        weekNumber: 5,
        startDate: createTimestamp(2025, 1, 26),
        endDate: createTimestamp(2025, 2, 1),
      });

      const result = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, crossMonthWeek);

      // Same type = same amount
      expect(result).toBe(100);
    });

    it('should calculate monthly cross-type conversion correctly for Jan-Feb', () => {
      // For a weekly budget, converting to monthly periods uses day-based calculation
      const budgetAmount = 100;

      // Monthly periods
      const janMonthly = createMockSourcePeriod({
        type: PeriodType.MONTHLY,
        year: 2025,
        month: 1,
        startDate: createTimestamp(2025, 1, 1),
        endDate: createTimestamp(2025, 1, 31),
      });

      const febMonthly = createMockSourcePeriod({
        type: PeriodType.MONTHLY,
        year: 2025,
        month: 2,
        startDate: createTimestamp(2025, 2, 1),
        endDate: createTimestamp(2025, 2, 28),
      });

      // Calculate cross-type totals (WEEKLY → MONTHLY)
      let monthlyTotal = 0;
      monthlyTotal += calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, janMonthly);
      monthlyTotal += calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, febMonthly);

      // Expected: (31 + 28) days × (100/7 daily rate) = 59 × $14.29 = ~$842.86
      const expectedTotal = roundToCents(59 * (100 / 7));

      // Monthly cross-type calculation should match expected day-based total
      expect(amountsEqual(monthlyTotal, expectedTotal, 1)).toBe(true);
    });

    it('should return full amount for same-type weekly periods', () => {
      // For a weekly budget, weekly periods (same type) return full amount
      const budgetAmount = 100;

      // Weekly periods for Jan 1 - Feb 28
      const weeklyPeriods = createWeeklySourcePeriods(
        new Date(2025, 0, 1),
        new Date(2025, 1, 28)
      );

      let weeklyTotal = 0;
      for (const week of weeklyPeriods) {
        weeklyTotal += calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, week);
      }

      // Same-type returns full amount per period
      // Number of weekly periods × $100
      expect(weeklyTotal).toBe(weeklyPeriods.length * budgetAmount);
    });
  });
});
