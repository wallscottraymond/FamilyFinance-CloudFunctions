/**
 * @file amountValidation.unit.test.ts
 * @description Unit tests for budget period amount sum validation
 *
 * VALIDATION APPROACH:
 * - The calculation system uses day-based daily rates for conversions
 * - Different period types may have slight discrepancies due to rounding
 * - Monthly → other: uses month-specific daily rate (amount/days_in_month)
 * - Bi-monthly → other: uses period-specific daily rate (amount/period_days)
 * - Weekly → other: uses fixed daily rate (amount/7)
 *
 * TOLERANCE EXPECTATIONS:
 * - Same type: Exact match (e.g., monthly budget to monthly period = same amount)
 * - Single month conversions: Within $0.02 (minimal rounding)
 * - Multi-month calculations: Within 3% of total (accumulated rounding)
 * - The sums are "approximately equal" - designed for practical budget tracking
 *
 * This test validates the calculation logic produces reasonable results.
 */

import { PeriodType } from '../../../types';
import { calculatePeriodAllocatedAmount } from '../utils/calculatePeriodAllocatedAmount';
import {
  roundToCents,
  amountsEqual,
  createTimestamp,
  createMockSourcePeriod,
  createMonthlySourcePeriods,
  createBiMonthlySourcePeriods,
  createWeeklySourcePeriods,
  calculatePeriodTypeTotals,
} from './helpers/budgetTestHelpers';

describe('Budget Period Amount Sum Validation', () => {
  // ============================================================================
  // MONTHLY BUDGET SUM VALIDATION
  // ============================================================================

  describe('Monthly Budget Sum Validation', () => {
    describe('Single Month - Same Type Returns Same Amount', () => {
      const months = [
        { month: 1, name: 'January', days: 31 },
        { month: 2, name: 'February', days: 28 },
        { month: 3, name: 'March', days: 31 },
        { month: 4, name: 'April', days: 30 },
        { month: 5, name: 'May', days: 31 },
        { month: 6, name: 'June', days: 30 },
        { month: 7, name: 'July', days: 31 },
        { month: 8, name: 'August', days: 31 },
        { month: 9, name: 'September', days: 30 },
        { month: 10, name: 'October', days: 31 },
        { month: 11, name: 'November', days: 30 },
        { month: 12, name: 'December', days: 31 },
      ];

      for (const { month, name, days } of months) {
        it(`should return budget amount for ${name} (${days} days) when same type`, () => {
          const budgetAmount = 100;

          // Monthly period
          const monthlyPeriod = createMockSourcePeriod({
            type: PeriodType.MONTHLY,
            year: 2025,
            month,
            startDate: createTimestamp(2025, month, 1),
            endDate: createTimestamp(2025, month, days),
          });

          // Same type returns same amount
          const monthlyTotal = calculatePeriodAllocatedAmount(
            budgetAmount,
            PeriodType.MONTHLY,
            monthlyPeriod
          );

          expect(monthlyTotal).toBe(budgetAmount);
        });
      }
    });

    describe('Single Month - Bi-Monthly Conversion', () => {
      it('should sum bi-monthly periods to approximately budget amount', () => {
        const budgetAmount = 100;
        const month = 1; // January
        const days = 31;

        // Bi-monthly periods
        const firstHalf = createMockSourcePeriod({
          type: PeriodType.BI_MONTHLY,
          year: 2025,
          month,
          biMonthlyHalf: 1,
          startDate: createTimestamp(2025, month, 1),
          endDate: createTimestamp(2025, month, 15),
        });

        const secondHalf = createMockSourcePeriod({
          type: PeriodType.BI_MONTHLY,
          year: 2025,
          month,
          biMonthlyHalf: 2,
          startDate: createTimestamp(2025, month, 16),
          endDate: createTimestamp(2025, month, days),
        });

        const biMonthlyTotal =
          calculatePeriodAllocatedAmount(budgetAmount, PeriodType.MONTHLY, firstHalf) +
          calculatePeriodAllocatedAmount(budgetAmount, PeriodType.MONTHLY, secondHalf);

        // Sum should equal budget amount within $0.02
        expect(amountsEqual(biMonthlyTotal, budgetAmount, 0.02)).toBe(true);
      });
    });

    describe('Single Month - Weekly Conversion', () => {
      it('should sum weekly periods to approximately budget amount', () => {
        const budgetAmount = 100;
        const month = 1; // January

        const weeks = createWeeklySourcePeriods(
          new Date(2025, month - 1, 1),
          new Date(2025, month - 1, 31)
        );

        let weeklyTotal = 0;
        for (const week of weeks) {
          weeklyTotal += calculatePeriodAllocatedAmount(budgetAmount, PeriodType.MONTHLY, week);
        }

        // Sum should equal budget amount within $0.05 (may have partial weeks)
        expect(amountsEqual(weeklyTotal, budgetAmount, 0.05)).toBe(true);
      });
    });

    describe('Multi-Month Ranges', () => {
      it('should have consistent sums for Q1 (Jan-Mar)', () => {
        const budgetAmount = 200;

        const monthlyPeriods = createMonthlySourcePeriods(2025, 1, 2025, 3);
        const biMonthlyPeriods = createBiMonthlySourcePeriods(2025, 1, 2025, 3);
        const weeklyPeriods = createWeeklySourcePeriods(
          new Date(2025, 0, 1),
          new Date(2025, 2, 31)
        );

        const summaries = calculatePeriodTypeTotals(
          budgetAmount,
          PeriodType.MONTHLY,
          monthlyPeriods,
          biMonthlyPeriods,
          weeklyPeriods
        );

        // Monthly total should be 3x budget
        expect(summaries.monthly.totalAmount).toBe(budgetAmount * 3);

        // Bi-monthly and weekly should be within 1% of monthly
        const maxAllowedDiff = summaries.monthly.totalAmount * 0.01;
        expect(Math.abs(summaries.biMonthly.totalAmount - summaries.monthly.totalAmount)).toBeLessThan(maxAllowedDiff);
        expect(Math.abs(summaries.weekly.totalAmount - summaries.monthly.totalAmount)).toBeLessThan(maxAllowedDiff);
      });

      it('should have consistent sums for full year', () => {
        const budgetAmount = 1000;

        const monthlyPeriods = createMonthlySourcePeriods(2025, 1, 2025, 12);
        const biMonthlyPeriods = createBiMonthlySourcePeriods(2025, 1, 2025, 12);
        const weeklyPeriods = createWeeklySourcePeriods(
          new Date(2025, 0, 1),
          new Date(2025, 11, 31)
        );

        const summaries = calculatePeriodTypeTotals(
          budgetAmount,
          PeriodType.MONTHLY,
          monthlyPeriods,
          biMonthlyPeriods,
          weeklyPeriods
        );

        // Monthly total should be 12x budget
        expect(summaries.monthly.totalAmount).toBe(budgetAmount * 12);

        // Bi-monthly should be very close (within 1%)
        const expectedTotal = budgetAmount * 12;
        expect(amountsEqual(summaries.biMonthly.totalAmount, expectedTotal, expectedTotal * 0.01)).toBe(true);

        // Weekly may have more variation due to week boundaries (within 2%)
        expect(amountsEqual(summaries.weekly.totalAmount, expectedTotal, expectedTotal * 0.02)).toBe(true);
      });
    });

    describe('User Example 1: Feb 1 - March 19', () => {
      it('should have full monthly periods return budget amount for same type', () => {
        // NOTE: The calculation function returns full budget amount for same-type periods
        // regardless of the actual date range. This is by design - same type = same amount.
        // For partial periods like "March 1-19", the actual allocation is handled
        // through bi-monthly or weekly views, not through partial monthly periods.
        const budgetAmount = 100;

        // Full February period (same type returns full amount)
        const febPeriod = createMockSourcePeriod({
          type: PeriodType.MONTHLY,
          year: 2025,
          month: 2,
          startDate: createTimestamp(2025, 2, 1),
          endDate: createTimestamp(2025, 2, 28),
        });

        // March partial - but as same type, returns full amount
        // (In practice, partial months are viewed via bi-monthly/weekly)
        const marchPeriod = createMockSourcePeriod({
          type: PeriodType.MONTHLY,
          year: 2025,
          month: 3,
          startDate: createTimestamp(2025, 3, 1),
          endDate: createTimestamp(2025, 3, 19),
        });

        // Same type always returns full budget amount
        const febTotal = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.MONTHLY, febPeriod);
        const marchTotal = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.MONTHLY, marchPeriod);

        expect(febTotal).toBe(budgetAmount);
        expect(marchTotal).toBe(budgetAmount); // Same type = same amount
      });

      it('should have bi-monthly periods sum to correct day-based total', () => {
        // Bi-monthly periods use day-based calculation (cross-type conversion)
        // This gives the accurate total for Feb 1 - March 19
        const budgetAmount = 100;

        const biMonthlyPeriods = [
          createMockSourcePeriod({
            type: PeriodType.BI_MONTHLY,
            year: 2025,
            month: 2,
            biMonthlyHalf: 1,
            startDate: createTimestamp(2025, 2, 1),
            endDate: createTimestamp(2025, 2, 15),
          }),
          createMockSourcePeriod({
            type: PeriodType.BI_MONTHLY,
            year: 2025,
            month: 2,
            biMonthlyHalf: 2,
            startDate: createTimestamp(2025, 2, 16),
            endDate: createTimestamp(2025, 2, 28),
          }),
          createMockSourcePeriod({
            type: PeriodType.BI_MONTHLY,
            year: 2025,
            month: 3,
            biMonthlyHalf: 1,
            startDate: createTimestamp(2025, 3, 1),
            endDate: createTimestamp(2025, 3, 15),
          }),
          createMockSourcePeriod({
            type: PeriodType.BI_MONTHLY,
            year: 2025,
            month: 3,
            biMonthlyHalf: 2,
            startDate: createTimestamp(2025, 3, 16),
            endDate: createTimestamp(2025, 3, 19),
          }),
        ];

        let biMonthlyTotal = 0;
        for (const period of biMonthlyPeriods) {
          biMonthlyTotal += calculatePeriodAllocatedAmount(budgetAmount, PeriodType.MONTHLY, period);
        }

        // Expected: Feb ($100) + March 1-19 (19 days × $100/31 = $61.29) = ~$161.29
        const expectedFeb = budgetAmount; // Full month
        const expectedMarchPartial = roundToCents(19 * (budgetAmount / 31));
        const expectedTotal = roundToCents(expectedFeb + expectedMarchPartial);

        // Within 1% of expected day-based total
        expect(amountsEqual(biMonthlyTotal, expectedTotal, expectedTotal * 0.01)).toBe(true);
      });
    });
  });

  // ============================================================================
  // BI-MONTHLY BUDGET SUM VALIDATION
  // ============================================================================

  describe('Bi-Monthly Budget Sum Validation', () => {
    describe('Same Type Returns Same Amount', () => {
      it('should return budget amount for bi-monthly period when same type', () => {
        const budgetAmount = 100;

        const firstHalf = createMockSourcePeriod({
          type: PeriodType.BI_MONTHLY,
          year: 2025,
          month: 1,
          biMonthlyHalf: 1,
          startDate: createTimestamp(2025, 1, 1),
          endDate: createTimestamp(2025, 1, 15),
        });

        const secondHalf = createMockSourcePeriod({
          type: PeriodType.BI_MONTHLY,
          year: 2025,
          month: 1,
          biMonthlyHalf: 2,
          startDate: createTimestamp(2025, 1, 16),
          endDate: createTimestamp(2025, 1, 31),
        });

        const first = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.BI_MONTHLY, firstHalf);
        const second = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.BI_MONTHLY, secondHalf);

        // Same type returns same amount
        expect(first).toBe(budgetAmount);
        expect(second).toBe(budgetAmount);
      });
    });

    describe('Monthly Conversion', () => {
      it('should calculate monthly as approximately 2x bi-monthly', () => {
        const budgetAmount = 100; // Per bi-monthly period

        const monthlyPeriod = createMockSourcePeriod({
          type: PeriodType.MONTHLY,
          year: 2025,
          month: 1,
          startDate: createTimestamp(2025, 1, 1),
          endDate: createTimestamp(2025, 1, 31),
        });

        const monthlyTotal = calculatePeriodAllocatedAmount(
          budgetAmount,
          PeriodType.BI_MONTHLY,
          monthlyPeriod
        );

        // Should be approximately 2x the bi-monthly amount (within 5%)
        const expected = budgetAmount * 2;
        expect(amountsEqual(monthlyTotal, expected, expected * 0.05)).toBe(true);
      });
    });

    describe('User Example 2: Feb 1 - April 13 (Bi-Monthly Budget)', () => {
      it('should have bi-monthly periods sum to 5 periods total', () => {
        const budgetAmount = 100;

        const biMonthlyPeriods = [
          createMockSourcePeriod({
            type: PeriodType.BI_MONTHLY,
            year: 2025,
            month: 2,
            biMonthlyHalf: 1,
            startDate: createTimestamp(2025, 2, 1),
            endDate: createTimestamp(2025, 2, 15),
          }),
          createMockSourcePeriod({
            type: PeriodType.BI_MONTHLY,
            year: 2025,
            month: 2,
            biMonthlyHalf: 2,
            startDate: createTimestamp(2025, 2, 16),
            endDate: createTimestamp(2025, 2, 28),
          }),
          createMockSourcePeriod({
            type: PeriodType.BI_MONTHLY,
            year: 2025,
            month: 3,
            biMonthlyHalf: 1,
            startDate: createTimestamp(2025, 3, 1),
            endDate: createTimestamp(2025, 3, 15),
          }),
          createMockSourcePeriod({
            type: PeriodType.BI_MONTHLY,
            year: 2025,
            month: 3,
            biMonthlyHalf: 2,
            startDate: createTimestamp(2025, 3, 16),
            endDate: createTimestamp(2025, 3, 31),
          }),
          createMockSourcePeriod({
            type: PeriodType.BI_MONTHLY,
            year: 2025,
            month: 4,
            biMonthlyHalf: 1,
            startDate: createTimestamp(2025, 4, 1),
            endDate: createTimestamp(2025, 4, 13),
          }),
        ];

        let total = 0;
        for (const period of biMonthlyPeriods) {
          total += calculatePeriodAllocatedAmount(budgetAmount, PeriodType.BI_MONTHLY, period);
        }

        // 5 bi-monthly periods at $100 each = $500
        // (same type returns same amount regardless of partial period)
        expect(total).toBe(500);
      });
    });
  });

  // ============================================================================
  // WEEKLY BUDGET SUM VALIDATION
  // ============================================================================

  describe('Weekly Budget Sum Validation', () => {
    describe('Same Type Returns Same Amount', () => {
      it('should return budget amount for full weekly period when same type', () => {
        const budgetAmount = 100;

        const week = createMockSourcePeriod({
          type: PeriodType.WEEKLY,
          year: 2025,
          weekNumber: 1,
          startDate: createTimestamp(2025, 1, 5),
          endDate: createTimestamp(2025, 1, 11),
        });

        const total = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, week);
        expect(total).toBe(budgetAmount);
      });
    });

    describe('Monthly Conversion', () => {
      it('should calculate monthly as approximately 4.3x weekly', () => {
        const budgetAmount = 100; // Per week

        const monthlyPeriod = createMockSourcePeriod({
          type: PeriodType.MONTHLY,
          year: 2025,
          month: 1,
          startDate: createTimestamp(2025, 1, 1),
          endDate: createTimestamp(2025, 1, 31),
        });

        const monthlyTotal = calculatePeriodAllocatedAmount(
          budgetAmount,
          PeriodType.WEEKLY,
          monthlyPeriod
        );

        // 31 days * ($100/7) = ~$442.86
        const expected = roundToCents(31 * (budgetAmount / 7));
        expect(amountsEqual(monthlyTotal, expected, 0.02)).toBe(true);
      });
    });

    describe('Full Year Consistency', () => {
      it('should have weekly periods cover full year consistently', () => {
        const budgetAmount = 150;

        const weeklyPeriods = createWeeklySourcePeriods(
          new Date(2025, 0, 1),
          new Date(2025, 11, 31)
        );

        let weeklyTotal = 0;
        for (const period of weeklyPeriods) {
          weeklyTotal += calculatePeriodAllocatedAmount(budgetAmount, PeriodType.WEEKLY, period);
        }

        // Should be approximately 52-53 weeks worth
        // 52 full weeks = 52 * $150 = $7800
        // May be slightly more due to partial weeks at year boundaries
        expect(weeklyTotal).toBeGreaterThan(budgetAmount * 51);
        expect(weeklyTotal).toBeLessThan(budgetAmount * 54);
      });
    });
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle zero budget amount', () => {
      const budgetAmount = 0;

      const monthlyPeriods = createMonthlySourcePeriods(2025, 1, 2025, 1);
      const biMonthlyPeriods = createBiMonthlySourcePeriods(2025, 1, 2025, 1);
      const weeklyPeriods = createWeeklySourcePeriods(
        new Date(2025, 0, 1),
        new Date(2025, 0, 31)
      );

      const summaries = calculatePeriodTypeTotals(
        budgetAmount,
        PeriodType.MONTHLY,
        monthlyPeriods,
        biMonthlyPeriods,
        weeklyPeriods
      );

      // All totals should be zero
      expect(summaries.monthly.totalAmount).toBe(0);
      expect(summaries.biMonthly.totalAmount).toBe(0);
      expect(summaries.weekly.totalAmount).toBe(0);
    });

    it('should handle leap year February', () => {
      const budgetAmount = 100;

      // February 2024 (leap year - 29 days)
      const monthlyPeriod = createMockSourcePeriod({
        type: PeriodType.MONTHLY,
        year: 2024,
        month: 2,
        startDate: createTimestamp(2024, 2, 1),
        endDate: createTimestamp(2024, 2, 29),
      });

      // Same type returns same amount
      const total = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.MONTHLY, monthlyPeriod);
      expect(total).toBe(budgetAmount);
    });

    it('should handle very large budget amounts', () => {
      const budgetAmount = 1000000; // $1 million

      const monthlyPeriod = createMockSourcePeriod({
        type: PeriodType.MONTHLY,
        year: 2025,
        month: 1,
        startDate: createTimestamp(2025, 1, 1),
        endDate: createTimestamp(2025, 1, 31),
      });

      // Same type returns same amount
      const total = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.MONTHLY, monthlyPeriod);
      expect(total).toBe(budgetAmount);
    });

    it('should handle decimal budget amounts', () => {
      const budgetAmount = 99.99;

      const monthlyPeriod = createMockSourcePeriod({
        type: PeriodType.MONTHLY,
        year: 2025,
        month: 1,
        startDate: createTimestamp(2025, 1, 1),
        endDate: createTimestamp(2025, 1, 31),
      });

      // Same type returns same amount
      const total = calculatePeriodAllocatedAmount(budgetAmount, PeriodType.MONTHLY, monthlyPeriod);
      expect(total).toBe(budgetAmount);
    });
  });

  // ============================================================================
  // CROSS-TYPE CONVERSION VALIDATION
  // ============================================================================

  describe('Cross-Type Conversion Validation', () => {
    it('should maintain reasonable proportions when converting monthly to weekly', () => {
      const budgetAmount = 100;

      // Full week within January
      const weeklyPeriod = createMockSourcePeriod({
        type: PeriodType.WEEKLY,
        year: 2025,
        weekNumber: 2,
        startDate: createTimestamp(2025, 1, 5),
        endDate: createTimestamp(2025, 1, 11),
      });

      const weeklyAmount = calculatePeriodAllocatedAmount(
        budgetAmount,
        PeriodType.MONTHLY,
        weeklyPeriod
      );

      // 7 days / 31 days * $100 ≈ $22.58
      const expected = roundToCents(7 * (budgetAmount / 31));
      expect(amountsEqual(weeklyAmount, expected, 0.02)).toBe(true);
    });

    it('should maintain reasonable proportions when converting weekly to monthly', () => {
      const budgetAmount = 100;

      const monthlyPeriod = createMockSourcePeriod({
        type: PeriodType.MONTHLY,
        year: 2025,
        month: 2, // February - 28 days
        startDate: createTimestamp(2025, 2, 1),
        endDate: createTimestamp(2025, 2, 28),
      });

      const monthlyAmount = calculatePeriodAllocatedAmount(
        budgetAmount,
        PeriodType.WEEKLY,
        monthlyPeriod
      );

      // 28 days * ($100/7) = $400
      const expected = roundToCents(28 * (budgetAmount / 7));
      expect(amountsEqual(monthlyAmount, expected, 0.02)).toBe(true);
    });

    it('should maintain reasonable proportions when converting bi-monthly to weekly', () => {
      const budgetAmount = 100;

      // Week within first half of month
      const weeklyPeriod = createMockSourcePeriod({
        type: PeriodType.WEEKLY,
        year: 2025,
        weekNumber: 2,
        startDate: createTimestamp(2025, 1, 5),
        endDate: createTimestamp(2025, 1, 11),
      });

      const weeklyAmount = calculatePeriodAllocatedAmount(
        budgetAmount,
        PeriodType.BI_MONTHLY,
        weeklyPeriod
      );

      // 7 days * ($100/15) ≈ $46.67 (first half has 15 days)
      const expected = roundToCents(7 * (budgetAmount / 15));
      expect(amountsEqual(weeklyAmount, expected, 0.02)).toBe(true);
    });
  });
});
