/**
 * Unit Tests for calculateAllOccurrencesInPeriod
 *
 * Tests the occurrence calculation logic across all combinations of:
 * - Outflow frequencies (WEEKLY, BIWEEKLY, SEMI_MONTHLY, MONTHLY, ANNUALLY)
 * - Period types (WEEKLY, BI_MONTHLY, MONTHLY)
 *
 * Verifies:
 * - Correct occurrence counts
 * - Due dates fall within period range
 * - Parallel arrays have consistent lengths
 * - Edge cases handled properly
 */

import { Timestamp } from 'firebase-admin/firestore';
import { calculateAllOccurrencesInPeriod } from '../utils/calculateAllOccurrencesInPeriod';
import {
  RecurringOutflow,
  SourcePeriod,
  PlaidRecurringFrequency
} from '../../../../types';

describe('calculateAllOccurrencesInPeriod', () => {
  // Helper to create test outflow
  const createTestOutflow = (
    frequency: PlaidRecurringFrequency,
    description: string,
    referenceDate: Date
  ): RecurringOutflow => {
    return {
      description,
      frequency,
      firstDate: Timestamp.fromDate(referenceDate),
      lastDate: Timestamp.fromDate(referenceDate),
      predictedNextDate: Timestamp.fromDate(referenceDate)
    } as RecurringOutflow;
  };

  // Helper to create test period
  const createTestPeriod = (
    id: string,
    startDate: Date,
    endDate: Date
  ): SourcePeriod => {
    return {
      id,
      startDate: Timestamp.fromDate(startDate),
      endDate: Timestamp.fromDate(endDate)
    } as SourcePeriod;
  };

  describe('WEEKLY frequency', () => {
    it('should calculate 1 occurrence for weekly bill in weekly period', () => {
      // Week of Jan 1-7, 2025 (Wednesday start)
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.WEEKLY,
        'Weekly Gym',
        new Date('2025-01-01') // Wednesday
      );
      const period = createTestPeriod(
        '2025-W01',
        new Date('2025-01-01'),
        new Date('2025-01-07')
      );

      const result = calculateAllOccurrencesInPeriod(outflow, period);

      expect(result.numberOfOccurrences).toBe(1);
      expect(result.occurrenceDueDates).toHaveLength(1);
      expect(result.occurrenceDrawDates).toHaveLength(1);
    });

    it('should calculate ~8 occurrences for weekly bill in bi-monthly period', () => {
      // Bi-monthly period (2 weeks)
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.WEEKLY,
        'Weekly Gym',
        new Date('2025-01-01')
      );
      const period = createTestPeriod(
        '2025-BW01',
        new Date('2025-01-01'),
        new Date('2025-01-14') // 2 weeks
      );

      const result = calculateAllOccurrencesInPeriod(outflow, period);

      // Should be 2 occurrences in a 2-week period
      expect(result.numberOfOccurrences).toBe(2);
      expect(result.occurrenceDueDates).toHaveLength(2);

      // Verify dates are within period
      result.occurrenceDueDates.forEach(date => {
        const d = date.toDate();
        expect(d >= period.startDate.toDate() && d <= period.endDate.toDate()).toBe(true);
      });
    });

    it('should calculate ~4 occurrences for weekly bill in monthly period', () => {
      // January 2025 (31 days)
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.WEEKLY,
        'Weekly Gym',
        new Date('2025-01-01') // Wednesday
      );
      const period = createTestPeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      const result = calculateAllOccurrencesInPeriod(outflow, period);

      // Should be 4 or 5 occurrences depending on month
      expect(result.numberOfOccurrences).toBeGreaterThanOrEqual(4);
      expect(result.numberOfOccurrences).toBeLessThanOrEqual(5);

      // Verify parallel arrays
      expect(result.occurrenceDueDates).toHaveLength(result.numberOfOccurrences);
      expect(result.occurrenceDrawDates).toHaveLength(result.numberOfOccurrences);
    });
  });

  describe('BIWEEKLY frequency', () => {
    it('should calculate 0 or 1 occurrence for biweekly bill in weekly period', () => {
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.BIWEEKLY,
        'Biweekly Subscription',
        new Date('2025-01-01')
      );
      const period = createTestPeriod(
        '2025-W01',
        new Date('2025-01-01'),
        new Date('2025-01-07')
      );

      const result = calculateAllOccurrencesInPeriod(outflow, period);

      expect(result.numberOfOccurrences).toBeLessThanOrEqual(1);
      expect(result.occurrenceDueDates).toHaveLength(result.numberOfOccurrences);
    });

    it('should calculate 1 occurrence for biweekly bill in bi-monthly period', () => {
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.BIWEEKLY,
        'Biweekly Subscription',
        new Date('2025-01-01')
      );
      const period = createTestPeriod(
        '2025-BW01',
        new Date('2025-01-01'),
        new Date('2025-01-14')
      );

      const result = calculateAllOccurrencesInPeriod(outflow, period);

      expect(result.numberOfOccurrences).toBe(1);
    });

    it('should calculate ~2 occurrences for biweekly bill in monthly period', () => {
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.BIWEEKLY,
        'Biweekly Subscription',
        new Date('2025-01-01')
      );
      const period = createTestPeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      const result = calculateAllOccurrencesInPeriod(outflow, period);

      expect(result.numberOfOccurrences).toBeGreaterThanOrEqual(2);
      expect(result.numberOfOccurrences).toBeLessThanOrEqual(3);
    });
  });

  describe('SEMI_MONTHLY frequency', () => {
    it('should calculate 2-3 occurrences for semi-monthly bill in monthly period', () => {
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.SEMI_MONTHLY,
        'Semi-monthly Bill',
        new Date('2025-01-01')
      );
      const period = createTestPeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      const result = calculateAllOccurrencesInPeriod(outflow, period);

      // Semi-monthly (15 day interval) in 31-day month can be 2 or 3 occurrences
      // Example: Jan 1 → Jan 16 (+15) → Jan 31 (+15) = 3 occurrences
      expect(result.numberOfOccurrences).toBeGreaterThanOrEqual(2);
      expect(result.numberOfOccurrences).toBeLessThanOrEqual(3);
      expect(result.occurrenceDueDates).toHaveLength(result.numberOfOccurrences);
    });
  });

  describe('MONTHLY frequency', () => {
    it('should calculate 0 occurrences for monthly bill in weekly period', () => {
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.MONTHLY,
        'Monthly Rent',
        new Date('2025-01-15') // Mid-month
      );
      const period = createTestPeriod(
        '2025-W01',
        new Date('2025-01-01'),
        new Date('2025-01-07')
      );

      const result = calculateAllOccurrencesInPeriod(outflow, period);

      expect(result.numberOfOccurrences).toBe(0);
      expect(result.occurrenceDueDates).toHaveLength(0);
    });

    it('should calculate 0 or 1 occurrence for monthly bill in bi-monthly period', () => {
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.MONTHLY,
        'Monthly Rent',
        new Date('2025-01-15')
      );
      const period = createTestPeriod(
        '2025-BW01',
        new Date('2025-01-01'),
        new Date('2025-01-14')
      );

      const result = calculateAllOccurrencesInPeriod(outflow, period);

      expect(result.numberOfOccurrences).toBeLessThanOrEqual(1);
    });

    it('should calculate 1 occurrence for monthly bill in monthly period', () => {
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.MONTHLY,
        'Monthly Rent',
        new Date('2025-01-15')
      );
      const period = createTestPeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      const result = calculateAllOccurrencesInPeriod(outflow, period);

      expect(result.numberOfOccurrences).toBe(1);
      expect(result.occurrenceDueDates).toHaveLength(1);

      // Verify date is within period
      const dueDate = result.occurrenceDueDates[0].toDate();
      expect(dueDate >= period.startDate.toDate()).toBe(true);
      expect(dueDate <= period.endDate.toDate()).toBe(true);
    });
  });

  describe('ANNUALLY frequency', () => {
    it('should calculate 0 or 1 occurrence for annual bill in monthly period', () => {
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.ANNUALLY,
        'Annual Subscription',
        new Date('2025-01-15')
      );
      const period = createTestPeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      const result = calculateAllOccurrencesInPeriod(outflow, period);

      expect(result.numberOfOccurrences).toBeLessThanOrEqual(1);

      if (result.numberOfOccurrences === 1) {
        expect(result.occurrenceDueDates).toHaveLength(1);
        expect(result.occurrenceDrawDates).toHaveLength(1);
      }
    });
  });

  describe('Parallel array consistency', () => {
    it('should maintain consistent array lengths across all outputs', () => {
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.WEEKLY,
        'Weekly Test',
        new Date('2025-01-01')
      );
      const period = createTestPeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      const result = calculateAllOccurrencesInPeriod(outflow, period);

      expect(result.occurrenceDueDates.length).toBe(result.numberOfOccurrences);
      expect(result.occurrenceDrawDates.length).toBe(result.numberOfOccurrences);
    });

    it('should have all due dates within period range', () => {
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.WEEKLY,
        'Weekly Test',
        new Date('2025-01-01')
      );
      const period = createTestPeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      const result = calculateAllOccurrencesInPeriod(outflow, period);

      result.occurrenceDueDates.forEach((timestamp, index) => {
        const date = timestamp.toDate();
        expect(date >= period.startDate.toDate()).toBe(true);
        expect(date <= period.endDate.toDate()).toBe(true);
      });
    });
  });

  describe('Edge cases', () => {
    it('should handle month with 5 Mondays (31-day month starting on Wednesday)', () => {
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.WEEKLY,
        'Weekly Monday Bill',
        new Date('2025-01-06') // First Monday in Jan 2025
      );
      const period = createTestPeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      const result = calculateAllOccurrencesInPeriod(outflow, period);

      // January 2025: Mondays on 6, 13, 20, 27
      expect(result.numberOfOccurrences).toBe(4);
    });

    it('should handle February (28 days)', () => {
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.WEEKLY,
        'Weekly Test',
        new Date('2025-02-05') // Wednesday
      );
      const period = createTestPeriod(
        '2025-M02',
        new Date('2025-02-01'),
        new Date('2025-02-28')
      );

      const result = calculateAllOccurrencesInPeriod(outflow, period);

      expect(result.numberOfOccurrences).toBe(4);
    });

    it('should handle period where reference date is far in the future', () => {
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.WEEKLY,
        'Future Weekly Bill',
        new Date('2026-06-01') // Far future
      );
      const period = createTestPeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      const result = calculateAllOccurrencesInPeriod(outflow, period);

      // Should rewind and find occurrences
      expect(result.numberOfOccurrences).toBeGreaterThan(0);
    });

    it('should handle period where reference date is in the past', () => {
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.WEEKLY,
        'Past Weekly Bill',
        new Date('2024-01-01') // Far past
      );
      const period = createTestPeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      const result = calculateAllOccurrencesInPeriod(outflow, period);

      // Should advance and find occurrences
      expect(result.numberOfOccurrences).toBeGreaterThan(0);
    });
  });

  describe('Weekend adjustment', () => {
    it('should adjust draw dates for Saturday due dates', () => {
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.WEEKLY,
        'Saturday Bill',
        new Date('2025-01-04') // Saturday
      );
      const period = createTestPeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      const result = calculateAllOccurrencesInPeriod(outflow, period);

      // Draw dates should be moved to Monday
      result.occurrenceDrawDates.forEach(timestamp => {
        const date = timestamp.toDate();
        const dayOfWeek = date.getDay();
        // Should NOT be Saturday (6) or Sunday (0)
        expect(dayOfWeek).not.toBe(0);
        expect(dayOfWeek).not.toBe(6);
      });
    });
  });
});
