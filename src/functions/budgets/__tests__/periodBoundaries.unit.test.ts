/**
 * @file periodBoundaries.unit.test.ts
 * @description Unit tests for budget period boundary validation
 *
 * Tests:
 * - Bi-monthly boundaries (1-15, 16-end)
 * - Weekly boundaries (Sunday start)
 * - Month-end boundaries
 * - Partial periods at budget start/end
 *
 * CRITICAL VALIDATION:
 * - Bi-monthly day 15 boundary is consistent
 * - Period date ranges don't overlap
 * - Period date ranges don't have gaps
 */

import { PeriodType } from '../../../types';
import {
  getDaysInMonth,
  createTimestamp,
  getDaysBetween,
  createMockSourcePeriod,
  createMonthlySourcePeriods,
  createWeeklySourcePeriods,
} from './helpers/budgetTestHelpers';

describe('Period Boundaries', () => {
  // ============================================================================
  // BI-MONTHLY BOUNDARIES
  // ============================================================================

  describe('Bi-Monthly Period Boundaries', () => {
    describe('First Half (Days 1-15)', () => {
      it('should always start on day 1', () => {
        for (let month = 1; month <= 12; month++) {
          const period = createMockSourcePeriod({
            type: PeriodType.BI_MONTHLY,
            year: 2025,
            month,
            biMonthlyHalf: 1,
            startDate: createTimestamp(2025, month, 1),
            endDate: createTimestamp(2025, month, 15),
          });

          const startDate = period.startDate.toDate();
          expect(startDate.getDate()).toBe(1);
        }
      });

      it('should always end on day 15', () => {
        for (let month = 1; month <= 12; month++) {
          const period = createMockSourcePeriod({
            type: PeriodType.BI_MONTHLY,
            year: 2025,
            month,
            biMonthlyHalf: 1,
            startDate: createTimestamp(2025, month, 1),
            endDate: createTimestamp(2025, month, 15),
          });

          const endDate = period.endDate.toDate();
          expect(endDate.getDate()).toBe(15);
        }
      });

      it('should always have exactly 15 days', () => {
        for (let month = 1; month <= 12; month++) {
          const period = createMockSourcePeriod({
            type: PeriodType.BI_MONTHLY,
            year: 2025,
            month,
            biMonthlyHalf: 1,
            startDate: createTimestamp(2025, month, 1),
            endDate: createTimestamp(2025, month, 15),
          });

          const days = getDaysBetween(period.startDate, period.endDate);
          expect(days).toBe(15);
        }
      });
    });

    describe('Second Half (Days 16-End)', () => {
      it('should always start on day 16', () => {
        for (let month = 1; month <= 12; month++) {
          const daysInMonth = getDaysInMonth(2025, month - 1);
          const period = createMockSourcePeriod({
            type: PeriodType.BI_MONTHLY,
            year: 2025,
            month,
            biMonthlyHalf: 2,
            startDate: createTimestamp(2025, month, 16),
            endDate: createTimestamp(2025, month, daysInMonth),
          });

          const startDate = period.startDate.toDate();
          expect(startDate.getDate()).toBe(16);
        }
      });

      it('should always end on last day of month', () => {
        for (let month = 1; month <= 12; month++) {
          const daysInMonth = getDaysInMonth(2025, month - 1);
          const period = createMockSourcePeriod({
            type: PeriodType.BI_MONTHLY,
            year: 2025,
            month,
            biMonthlyHalf: 2,
            startDate: createTimestamp(2025, month, 16),
            endDate: createTimestamp(2025, month, daysInMonth),
          });

          const endDate = period.endDate.toDate();
          expect(endDate.getDate()).toBe(daysInMonth);
        }
      });

      it('should have correct days for each month type', () => {
        const expectedDays: { [month: number]: number } = {
          1: 16,  // January: 31 - 15 = 16
          2: 13,  // February (non-leap): 28 - 15 = 13
          3: 16,  // March: 31 - 15 = 16
          4: 15,  // April: 30 - 15 = 15
          5: 16,  // May: 31 - 15 = 16
          6: 15,  // June: 30 - 15 = 15
          7: 16,  // July: 31 - 15 = 16
          8: 16,  // August: 31 - 15 = 16
          9: 15,  // September: 30 - 15 = 15
          10: 16, // October: 31 - 15 = 16
          11: 15, // November: 30 - 15 = 15
          12: 16, // December: 31 - 15 = 16
        };

        for (let month = 1; month <= 12; month++) {
          const daysInMonth = getDaysInMonth(2025, month - 1);
          const period = createMockSourcePeriod({
            type: PeriodType.BI_MONTHLY,
            year: 2025,
            month,
            biMonthlyHalf: 2,
            startDate: createTimestamp(2025, month, 16),
            endDate: createTimestamp(2025, month, daysInMonth),
          });

          const days = getDaysBetween(period.startDate, period.endDate);
          expect(days).toBe(expectedDays[month]);
        }
      });

      it('should have 14 days for leap year February', () => {
        // February 2024 (leap year): 29 - 15 = 14 days
        const period = createMockSourcePeriod({
          type: PeriodType.BI_MONTHLY,
          year: 2024,
          month: 2,
          biMonthlyHalf: 2,
          startDate: createTimestamp(2024, 2, 16),
          endDate: createTimestamp(2024, 2, 29),
        });

        const days = getDaysBetween(period.startDate, period.endDate);
        expect(days).toBe(14);
      });
    });

    describe('Bi-Monthly Coverage', () => {
      it('should have no gaps between first and second half', () => {
        for (let month = 1; month <= 12; month++) {
          const daysInMonth = getDaysInMonth(2025, month - 1);

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
            endDate: createTimestamp(2025, month, daysInMonth),
          });

          // Day after first half end should be second half start
          const firstHalfEnd = firstHalf.endDate.toDate();
          const secondHalfStart = secondHalf.startDate.toDate();

          const dayAfterFirstHalf = new Date(firstHalfEnd);
          dayAfterFirstHalf.setDate(dayAfterFirstHalf.getDate() + 1);

          expect(dayAfterFirstHalf.getDate()).toBe(secondHalfStart.getDate());
        }
      });

      it('should cover entire month with no overlap', () => {
        for (let month = 1; month <= 12; month++) {
          const daysInMonth = getDaysInMonth(2025, month - 1);

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
            endDate: createTimestamp(2025, month, daysInMonth),
          });

          const firstDays = getDaysBetween(firstHalf.startDate, firstHalf.endDate);
          const secondDays = getDaysBetween(secondHalf.startDate, secondHalf.endDate);

          expect(firstDays + secondDays).toBe(daysInMonth);
        }
      });
    });
  });

  // ============================================================================
  // MONTHLY BOUNDARIES
  // ============================================================================

  describe('Monthly Period Boundaries', () => {
    it('should start on day 1 for all months', () => {
      const periods = createMonthlySourcePeriods(2025, 1, 2025, 12);

      for (const period of periods) {
        const startDate = period.startDate.toDate();
        expect(startDate.getDate()).toBe(1);
      }
    });

    it('should end on last day of each month', () => {
      const periods = createMonthlySourcePeriods(2025, 1, 2025, 12);

      for (const period of periods) {
        const endDate = period.endDate.toDate();
        const month = endDate.getMonth(); // 0-indexed
        const expectedLastDay = getDaysInMonth(endDate.getFullYear(), month);
        expect(endDate.getDate()).toBe(expectedLastDay);
      }
    });

    it('should have correct days for each month', () => {
      const expectedDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      const periods = createMonthlySourcePeriods(2025, 1, 2025, 12);

      for (let i = 0; i < periods.length; i++) {
        const days = getDaysBetween(periods[i].startDate, periods[i].endDate);
        expect(days).toBe(expectedDays[i]);
      }
    });

    it('should handle leap year February correctly', () => {
      const leapYearPeriods = createMonthlySourcePeriods(2024, 2, 2024, 2);
      const febPeriod = leapYearPeriods[0];

      const days = getDaysBetween(febPeriod.startDate, febPeriod.endDate);
      expect(days).toBe(29);
    });
  });

  // ============================================================================
  // WEEKLY BOUNDARIES
  // ============================================================================

  describe('Weekly Period Boundaries', () => {
    describe('Week Start Day (Sunday)', () => {
      it('should start weeks on Sunday for full weeks', () => {
        // Generate weeks for January 2025
        // January 1, 2025 is a Wednesday
        // First Sunday is January 5, 2025
        const weeks = createWeeklySourcePeriods(
          new Date(2025, 0, 5), // Start from first Sunday
          new Date(2025, 0, 25)
        );

        for (const week of weeks) {
          const startDate = week.startDate.toDate();
          expect(startDate.getDay()).toBe(0); // Sunday
        }
      });

      it('should clip weeks to budget boundaries when budget starts mid-week', () => {
        // If budget starts mid-week (Wednesday Jan 8), the first week is clipped
        // to start from the budget start date (not the previous Sunday)
        // This ensures sum calculations are accurate for the budget period
        const weeks = createWeeklySourcePeriods(
          new Date(2025, 0, 8), // Wednesday
          new Date(2025, 0, 20)
        );

        // First week should start on budget start date (Jan 8, Wednesday)
        const firstWeek = weeks[0];
        const startDate = firstWeek.startDate.toDate();
        expect(startDate.getDate()).toBe(8);

        // First week ends on Saturday Jan 11 (end of that calendar week)
        const endDate = firstWeek.endDate.toDate();
        expect(endDate.getDay()).toBe(6); // Saturday
        expect(endDate.getDate()).toBe(11);
      });
    });

    describe('Week End Day (Saturday)', () => {
      it('should end full weeks on Saturday', () => {
        const weeks = createWeeklySourcePeriods(
          new Date(2025, 0, 5), // Sunday
          new Date(2025, 0, 25)
        );

        // All weeks except potentially the last one should end on Saturday
        for (let i = 0; i < weeks.length - 1; i++) {
          const endDate = weeks[i].endDate.toDate();
          expect(endDate.getDay()).toBe(6); // Saturday
        }
      });
    });

    describe('Week Duration', () => {
      it('should have 7 days for full weeks', () => {
        const weeks = createWeeklySourcePeriods(
          new Date(2025, 0, 5), // Sunday Jan 5
          new Date(2025, 0, 25)
        );

        // All weeks except the last should have 7 days
        for (let i = 0; i < weeks.length - 1; i++) {
          const days = getDaysBetween(weeks[i].startDate, weeks[i].endDate);
          expect(days).toBe(7);
        }
      });

      it('should handle partial week at budget end', () => {
        // Budget ends on Wednesday Jan 22
        const weeks = createWeeklySourcePeriods(
          new Date(2025, 0, 5), // Sunday Jan 5
          new Date(2025, 0, 22) // Wednesday Jan 22
        );

        const lastWeek = weeks[weeks.length - 1];
        const lastWeekDays = getDaysBetween(lastWeek.startDate, lastWeek.endDate);

        // Last week should end on the budget end date, not Saturday
        const endDate = lastWeek.endDate.toDate();
        expect(endDate.getDate()).toBe(22);
        expect(lastWeekDays).toBeLessThanOrEqual(7);
      });
    });

    describe('Weeks Crossing Month Boundaries', () => {
      it('should create weeks that span month boundaries', () => {
        // Create weeks for Jan-Feb transition
        const weeks = createWeeklySourcePeriods(
          new Date(2025, 0, 26), // Sunday Jan 26
          new Date(2025, 1, 8)  // Saturday Feb 8
        );

        // First week should span Jan 26 - Feb 1
        const firstWeek = weeks[0];
        const startMonth = firstWeek.startDate.toDate().getMonth();
        const endMonth = firstWeek.endDate.toDate().getMonth();

        // Should span two months (Jan = 0, Feb = 1)
        expect(startMonth).toBe(0); // January
        expect(endMonth).toBe(1);   // February
      });

      it('should not skip days when crossing month boundaries', () => {
        // Generate weeks for Jan 26 - Feb 15
        const weeks = createWeeklySourcePeriods(
          new Date(2025, 0, 26),
          new Date(2025, 1, 15)
        );

        // Verify no gaps between consecutive weeks
        for (let i = 0; i < weeks.length - 1; i++) {
          const currentEnd = weeks[i].endDate.toDate();
          const nextStart = weeks[i + 1].startDate.toDate();

          // Day after current week end should be next week start
          const dayAfter = new Date(currentEnd);
          dayAfter.setDate(dayAfter.getDate() + 1);

          expect(dayAfter.getTime()).toBe(nextStart.getTime());
        }
      });
    });
  });

  // ============================================================================
  // CROSS-PERIOD BOUNDARY ALIGNMENT
  // ============================================================================

  describe('Cross-Period Boundary Alignment', () => {
    it('should have bi-monthly boundary on day 15 regardless of week alignment', () => {
      // Day 15 is always the bi-monthly boundary
      // This should not change based on what day of the week it is

      for (let month = 1; month <= 12; month++) {
        const firstHalf = createMockSourcePeriod({
          type: PeriodType.BI_MONTHLY,
          year: 2025,
          month,
          biMonthlyHalf: 1,
          startDate: createTimestamp(2025, month, 1),
          endDate: createTimestamp(2025, month, 15),
        });

        const endDate = firstHalf.endDate.toDate();
        expect(endDate.getDate()).toBe(15);

        // Verify the day of week varies (not always the same day)
        // This confirms boundary is date-based, not day-of-week-based
      }
    });

    it('should have monthly totals equal bi-monthly totals when periods align', () => {
      // For any complete month, the sum of:
      // - 2 bi-monthly periods (1-15 and 16-end)
      // Should equal:
      // - 1 monthly period (1-end)

      for (let month = 1; month <= 12; month++) {
        const daysInMonth = getDaysInMonth(2025, month - 1);

        const monthly = createMockSourcePeriod({
          type: PeriodType.MONTHLY,
          year: 2025,
          month,
          startDate: createTimestamp(2025, month, 1),
          endDate: createTimestamp(2025, month, daysInMonth),
        });

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
          endDate: createTimestamp(2025, month, daysInMonth),
        });

        const monthlyDays = getDaysBetween(monthly.startDate, monthly.endDate);
        const biMonthlyDays =
          getDaysBetween(firstHalf.startDate, firstHalf.endDate) +
          getDaysBetween(secondHalf.startDate, secondHalf.endDate);

        expect(monthlyDays).toBe(biMonthlyDays);
      }
    });
  });

  // ============================================================================
  // PARTIAL PERIOD BOUNDARIES
  // ============================================================================

  describe('Partial Period Boundaries', () => {
    it('should handle budget starting mid-month', () => {
      // Budget starts on Jan 15
      const partialMonth = createMockSourcePeriod({
        type: PeriodType.MONTHLY,
        year: 2025,
        month: 1,
        startDate: createTimestamp(2025, 1, 15),
        endDate: createTimestamp(2025, 1, 31),
      });

      const days = getDaysBetween(partialMonth.startDate, partialMonth.endDate);
      expect(days).toBe(17); // Jan 15-31
    });

    it('should handle budget ending mid-month', () => {
      // Budget ends on March 19
      const partialMonth = createMockSourcePeriod({
        type: PeriodType.MONTHLY,
        year: 2025,
        month: 3,
        startDate: createTimestamp(2025, 3, 1),
        endDate: createTimestamp(2025, 3, 19),
      });

      const days = getDaysBetween(partialMonth.startDate, partialMonth.endDate);
      expect(days).toBe(19); // March 1-19
    });

    it('should handle budget starting and ending mid-month', () => {
      // Budget from Jan 10 to Jan 25
      const partialMonth = createMockSourcePeriod({
        type: PeriodType.MONTHLY,
        year: 2025,
        month: 1,
        startDate: createTimestamp(2025, 1, 10),
        endDate: createTimestamp(2025, 1, 25),
      });

      const days = getDaysBetween(partialMonth.startDate, partialMonth.endDate);
      expect(days).toBe(16); // Jan 10-25
    });

    it('should handle partial bi-monthly at budget end', () => {
      // Budget ends on April 13 (13 days into first bi-monthly)
      const partialBiMonthly = createMockSourcePeriod({
        type: PeriodType.BI_MONTHLY,
        year: 2025,
        month: 4,
        biMonthlyHalf: 1,
        startDate: createTimestamp(2025, 4, 1),
        endDate: createTimestamp(2025, 4, 13),
      });

      const days = getDaysBetween(partialBiMonthly.startDate, partialBiMonthly.endDate);
      expect(days).toBe(13);
    });
  });
});
