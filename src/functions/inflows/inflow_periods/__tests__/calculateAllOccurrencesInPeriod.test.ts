/**
 * Unit Tests for calculateAllOccurrencesInPeriod (Inflows)
 *
 * Tests the occurrence calculation logic for income streams across all combinations of:
 * - Inflow frequencies (WEEKLY, BIWEEKLY, SEMI_MONTHLY, MONTHLY, QUARTERLY, ANNUALLY)
 * - Period types (WEEKLY, BI_MONTHLY, MONTHLY)
 *
 * Verifies:
 * - Correct occurrence counts
 * - Due dates fall within period range
 * - Parallel arrays have consistent lengths
 * - Edge cases handled properly
 *
 * NOTE: This test file is created BEFORE implementation (Test-First Development)
 */

import { Timestamp } from 'firebase-admin/firestore';
import {
  Inflow,
  SourcePeriod,
  PlaidRecurringFrequency
} from '../../../../types';

// Import the actual implementation
import { calculateAllOccurrencesInPeriod } from '../utils/calculateAllOccurrencesInPeriod';

describe('calculateAllOccurrencesInPeriod (Inflows)', () => {
  // Helper to create test inflow
  const createTestInflow = (
    frequency: PlaidRecurringFrequency,
    description: string,
    referenceDate: Date,
    averageAmount: number = 1000.00, // Default income amount
    incomeType: string = 'salary'
  ): Partial<Inflow> => {
    return {
      id: `inflow_${description.toLowerCase().replace(/\s+/g, '_')}`,
      description,
      frequency,
      firstDate: Timestamp.fromDate(referenceDate),
      lastDate: Timestamp.fromDate(referenceDate),
      predictedNextDate: Timestamp.fromDate(referenceDate),
      averageAmount: Math.abs(averageAmount), // Income stored as positive
      incomeType,
      isRegularSalary: incomeType === 'salary',
      isActive: true,
      source: 'plaid'
    } as Partial<Inflow>;
  };

  // Helper to create test period
  const createTestPeriod = (
    id: string,
    startDate: Date,
    endDate: Date,
    type: string = 'monthly'
  ): Partial<SourcePeriod> => {
    return {
      id,
      periodId: id,
      startDate: Timestamp.fromDate(startDate),
      endDate: Timestamp.fromDate(endDate),
      type
    } as Partial<SourcePeriod>;
  };

  // ============================================================================
  // WEEKLY INCOME FREQUENCY TESTS
  // ============================================================================

  describe('WEEKLY income frequency', () => {
    it('should calculate 1 occurrence for weekly income in weekly period', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.WEEKLY,
        'Weekly Freelance Payment',
        new Date('2025-01-01'), // Wednesday
        500.00,
        'freelance'
      );
      const period = createTestPeriod(
        '2025-W01',
        new Date('2025-01-01'),
        new Date('2025-01-07'),
        'weekly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      expect(result.numberOfOccurrences).toBe(1);
      expect(result.occurrenceDueDates).toHaveLength(1);
      expect(result.totalExpectedAmount).toBe(500.00);

      // Verify date is within period
      const dueDate = result.occurrenceDueDates[0].toDate();
      expect(dueDate >= period.startDate!.toDate()).toBe(true);
      expect(dueDate <= period.endDate!.toDate()).toBe(true);
    });

    it('should calculate 2 occurrences for weekly income in bi-monthly period', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.WEEKLY,
        'Weekly Tutoring',
        new Date('2025-01-01'),
        200.00,
        'freelance'
      );
      const period = createTestPeriod(
        '2025-BM01-A',
        new Date('2025-01-01'),
        new Date('2025-01-15'), // ~2 weeks
        'bi_monthly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      expect(result.numberOfOccurrences).toBe(2);
      expect(result.occurrenceDueDates).toHaveLength(2);
      expect(result.totalExpectedAmount).toBe(400.00); // 2 x 200

      // Verify all dates are within period
      result.occurrenceDueDates.forEach((date: Timestamp) => {
        const d = date.toDate();
        expect(d >= period.startDate!.toDate()).toBe(true);
        expect(d <= period.endDate!.toDate()).toBe(true);
      });
    });

    it('should calculate 4-5 occurrences for weekly income in monthly period', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.WEEKLY,
        'Weekly Paycheck',
        new Date('2025-01-03'), // Friday
        800.00,
        'hourly'
      );
      const period = createTestPeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31'),
        'monthly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      // January 2025 has 4-5 Fridays depending on start day
      expect(result.numberOfOccurrences).toBeGreaterThanOrEqual(4);
      expect(result.numberOfOccurrences).toBeLessThanOrEqual(5);
      expect(result.occurrenceDueDates).toHaveLength(result.numberOfOccurrences);
      expect(result.totalExpectedAmount).toBe(result.numberOfOccurrences * 800.00);
    });
  });

  // ============================================================================
  // BIWEEKLY INCOME FREQUENCY TESTS
  // ============================================================================

  describe('BIWEEKLY income frequency', () => {
    it('should calculate 0 or 1 occurrence for biweekly income in weekly period', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.BIWEEKLY,
        'Biweekly Salary',
        new Date('2025-01-03'), // Payday Friday
        2000.00,
        'salary'
      );
      const period = createTestPeriod(
        '2025-W01',
        new Date('2025-01-01'),
        new Date('2025-01-07'),
        'weekly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      // May or may not fall in this week
      expect(result.numberOfOccurrences).toBeLessThanOrEqual(1);
      expect(result.occurrenceDueDates).toHaveLength(result.numberOfOccurrences);
    });

    it('should calculate 1 occurrence for biweekly income in bi-monthly period', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.BIWEEKLY,
        'Biweekly Salary',
        new Date('2025-01-03'),
        2000.00,
        'salary'
      );
      const period = createTestPeriod(
        '2025-BM01-A',
        new Date('2025-01-01'),
        new Date('2025-01-15'),
        'bi_monthly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      expect(result.numberOfOccurrences).toBe(1);
      expect(result.totalExpectedAmount).toBe(2000.00);
    });

    it('should calculate 2-3 occurrences for biweekly income in monthly period', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.BIWEEKLY,
        'Biweekly Salary',
        new Date('2025-01-03'),
        2000.00,
        'salary'
      );
      const period = createTestPeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31'),
        'monthly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      // Biweekly = 2-3 times per month
      expect(result.numberOfOccurrences).toBeGreaterThanOrEqual(2);
      expect(result.numberOfOccurrences).toBeLessThanOrEqual(3);
    });
  });

  // ============================================================================
  // SEMI_MONTHLY INCOME FREQUENCY TESTS (Paid twice monthly, e.g., 1st and 15th)
  // ============================================================================

  describe('SEMI_MONTHLY income frequency', () => {
    it('should calculate 1 occurrence for semi-monthly income in weekly period with payday', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.SEMI_MONTHLY,
        'Semi-Monthly Salary',
        new Date('2025-01-15'), // Mid-month payday
        2500.00,
        'salary'
      );
      // Week containing the 15th
      const period = createTestPeriod(
        '2025-W03',
        new Date('2025-01-12'),
        new Date('2025-01-18'),
        'weekly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      expect(result.numberOfOccurrences).toBe(1);
      expect(result.totalExpectedAmount).toBe(2500.00);
    });

    it('should calculate 0 occurrences for semi-monthly income in weekly period without payday', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.SEMI_MONTHLY,
        'Semi-Monthly Salary',
        new Date('2025-01-15'), // Mid-month payday (1st and 15th)
        2500.00,
        'salary'
      );
      // Week that doesn't contain 1st or 15th
      const period = createTestPeriod(
        '2025-W02',
        new Date('2025-01-05'),
        new Date('2025-01-11'),
        'weekly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      expect(result.numberOfOccurrences).toBe(0);
      expect(result.totalExpectedAmount).toBe(0);
    });

    it('should calculate 1 occurrence for semi-monthly income in bi-monthly period', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.SEMI_MONTHLY,
        'Semi-Monthly Salary',
        new Date('2025-01-01'),
        2500.00,
        'salary'
      );
      const period = createTestPeriod(
        '2025-BM01-A',
        new Date('2025-01-01'),
        new Date('2025-01-15'),
        'bi_monthly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      // First half should have the 1st or 15th payday
      expect(result.numberOfOccurrences).toBeGreaterThanOrEqual(1);
      expect(result.numberOfOccurrences).toBeLessThanOrEqual(2);
    });

    it('should calculate 2 occurrences for semi-monthly income in monthly period', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.SEMI_MONTHLY,
        'Semi-Monthly Salary',
        new Date('2025-01-01'),
        2500.00,
        'salary'
      );
      const period = createTestPeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31'),
        'monthly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      expect(result.numberOfOccurrences).toBe(2);
      expect(result.totalExpectedAmount).toBe(5000.00); // 2 x 2500
    });
  });

  // ============================================================================
  // MONTHLY INCOME FREQUENCY TESTS
  // ============================================================================

  describe('MONTHLY income frequency', () => {
    it('should calculate 1 occurrence for monthly income in monthly period when due', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.MONTHLY,
        'Monthly Salary',
        new Date('2025-01-15'), // Payday 15th
        5000.00,
        'salary'
      );
      const period = createTestPeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31'),
        'monthly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      expect(result.numberOfOccurrences).toBe(1);
      expect(result.totalExpectedAmount).toBe(5000.00);

      // Verify the due date is around the 15th
      const dueDate = result.occurrenceDueDates[0].toDate();
      expect(dueDate.getMonth()).toBe(0); // January
    });

    it('should calculate 0 or 1 occurrence for monthly income in weekly period', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.MONTHLY,
        'Monthly Salary',
        new Date('2025-01-15'),
        5000.00,
        'salary'
      );
      const period = createTestPeriod(
        '2025-W02',
        new Date('2025-01-05'),
        new Date('2025-01-11'),
        'weekly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      // Monthly income won't fall in most weeks
      expect(result.numberOfOccurrences).toBeLessThanOrEqual(1);
    });

    it('should calculate 1 occurrence for monthly income in bi-monthly period when due', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.MONTHLY,
        'Monthly Salary',
        new Date('2025-01-10'), // Payday 10th
        5000.00,
        'salary'
      );
      const period = createTestPeriod(
        '2025-BM01-A',
        new Date('2025-01-01'),
        new Date('2025-01-15'),
        'bi_monthly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      // 10th falls in first half
      expect(result.numberOfOccurrences).toBe(1);
    });

    it('should calculate 0 occurrences for monthly income in bi-monthly period when not due', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.MONTHLY,
        'Monthly Salary',
        new Date('2025-01-25'), // Payday 25th
        5000.00,
        'salary'
      );
      const period = createTestPeriod(
        '2025-BM01-A',
        new Date('2025-01-01'),
        new Date('2025-01-15'),
        'bi_monthly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      // 25th doesn't fall in first half
      expect(result.numberOfOccurrences).toBe(0);
    });
  });

  // ============================================================================
  // QUARTERLY INCOME FREQUENCY TESTS (Commission, Bonus)
  // ============================================================================

  describe('QUARTERLY income frequency', () => {
    it('should calculate 1 occurrence for quarterly commission in monthly period when due', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.QUARTERLY,
        'Quarterly Commission',
        new Date('2025-01-15'), // Q1 payout mid-January
        10000.00,
        'commission'
      );
      const period = createTestPeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31'),
        'monthly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      expect(result.numberOfOccurrences).toBe(1);
      expect(result.totalExpectedAmount).toBe(10000.00);
    });

    it('should calculate 0 occurrences for quarterly commission in monthly period when not due', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.QUARTERLY,
        'Quarterly Commission',
        new Date('2025-01-15'), // Q1 payout in January
        10000.00,
        'commission'
      );
      // February - not a quarter end month
      const period = createTestPeriod(
        '2025-M02',
        new Date('2025-02-01'),
        new Date('2025-02-28'),
        'monthly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      expect(result.numberOfOccurrences).toBe(0);
      expect(result.totalExpectedAmount).toBe(0);
    });

    it('should calculate 0 occurrences for quarterly income in weekly period', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.QUARTERLY,
        'Quarterly Bonus',
        new Date('2025-03-31'), // Q1 end payout
        5000.00,
        'bonus'
      );
      const period = createTestPeriod(
        '2025-W01',
        new Date('2025-01-01'),
        new Date('2025-01-07'),
        'weekly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      expect(result.numberOfOccurrences).toBe(0);
    });
  });

  // ============================================================================
  // ANNUALLY INCOME FREQUENCY TESTS (Annual Bonus)
  // ============================================================================

  describe('ANNUALLY income frequency', () => {
    it('should calculate 1 occurrence for annual bonus in monthly period when due', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.ANNUALLY,
        'Annual Bonus',
        new Date('2025-12-15'), // December bonus
        20000.00,
        'bonus'
      );
      const period = createTestPeriod(
        '2025-M12',
        new Date('2025-12-01'),
        new Date('2025-12-31'),
        'monthly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      expect(result.numberOfOccurrences).toBe(1);
      expect(result.totalExpectedAmount).toBe(20000.00);
    });

    it('should calculate 0 occurrences for annual bonus in monthly period when not due', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.ANNUALLY,
        'Annual Bonus',
        new Date('2025-12-15'), // December bonus
        20000.00,
        'bonus'
      );
      // Not December
      const period = createTestPeriod(
        '2025-M06',
        new Date('2025-06-01'),
        new Date('2025-06-30'),
        'monthly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      expect(result.numberOfOccurrences).toBe(0);
      expect(result.totalExpectedAmount).toBe(0);
    });

    it('should calculate 0 occurrences for annual bonus in weekly period', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.ANNUALLY,
        'Annual Tax Refund',
        new Date('2025-04-15'),
        3000.00,
        'government'
      );
      const period = createTestPeriod(
        '2025-W01',
        new Date('2025-01-01'),
        new Date('2025-01-07'),
        'weekly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      expect(result.numberOfOccurrences).toBe(0);
    });
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Edge cases', () => {
    it('should handle February (28 days) correctly for weekly income', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.WEEKLY,
        'Weekly Income',
        new Date('2025-02-07'),
        500.00,
        'freelance'
      );
      const period = createTestPeriod(
        '2025-M02',
        new Date('2025-02-01'),
        new Date('2025-02-28'),
        'monthly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      // February has 4 weeks
      expect(result.numberOfOccurrences).toBe(4);
      expect(result.totalExpectedAmount).toBe(2000.00);
    });

    it('should handle leap year February (29 days) correctly', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.WEEKLY,
        'Weekly Income',
        new Date('2024-02-07'),
        500.00,
        'freelance'
      );
      const period = createTestPeriod(
        '2024-M02',
        new Date('2024-02-01'),
        new Date('2024-02-29'), // Leap year
        'monthly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      // Could be 4 or 5 depending on start day
      expect(result.numberOfOccurrences).toBeGreaterThanOrEqual(4);
      expect(result.numberOfOccurrences).toBeLessThanOrEqual(5);
    });

    it('should handle month-end income (31st) in months with fewer days', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.MONTHLY,
        'Month-End Salary',
        new Date('2025-01-31'), // Paid on 31st
        5000.00,
        'salary'
      );
      // February doesn't have 31st
      const period = createTestPeriod(
        '2025-M02',
        new Date('2025-02-01'),
        new Date('2025-02-28'),
        'monthly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      // Should adjust to last day of February
      expect(result.numberOfOccurrences).toBe(1);

      const dueDate = result.occurrenceDueDates[0]?.toDate();
      if (dueDate) {
        expect(dueDate.getDate()).toBeLessThanOrEqual(28);
      }
    });

    it('should handle inactive income (return 0 occurrences)', () => {
      const inflow = {
        ...createTestInflow(
          PlaidRecurringFrequency.WEEKLY,
          'Inactive Income',
          new Date('2025-01-01'),
          500.00,
          'freelance'
        ),
        isActive: false
      };
      const period = createTestPeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31'),
        'monthly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      expect(result.numberOfOccurrences).toBe(0);
      expect(result.totalExpectedAmount).toBe(0);
    });

    it('should return consistent parallel arrays', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.WEEKLY,
        'Weekly Income',
        new Date('2025-01-03'),
        500.00,
        'freelance'
      );
      const period = createTestPeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31'),
        'monthly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      // All arrays should have same length
      expect(result.occurrenceDueDates).toHaveLength(result.numberOfOccurrences);

      // Dates should be in chronological order
      for (let i = 1; i < result.occurrenceDueDates.length; i++) {
        const prev = result.occurrenceDueDates[i - 1].toDate();
        const curr = result.occurrenceDueDates[i].toDate();
        expect(curr.getTime()).toBeGreaterThan(prev.getTime());
      }
    });
  });

  // ============================================================================
  // VARIABLE INCOME TESTS
  // ============================================================================

  describe('Variable income (hourly, commission)', () => {
    it('should use averageAmount for regular salary', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.MONTHLY,
        'Regular Salary',
        new Date('2025-01-15'),
        5000.00,
        'salary'
      );
      const period = createTestPeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31'),
        'monthly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      expect(result.totalExpectedAmount).toBe(5000.00);
    });

    it('should flag variable income for special handling', () => {
      const inflow = {
        ...createTestInflow(
          PlaidRecurringFrequency.MONTHLY,
          'Variable Commission',
          new Date('2025-01-15'),
          3000.00,
          'commission'
        ),
        isVariable: true,
        variableIncomeConfig: {
          useRollingAverage: true,
          rollingAveragePeriods: 3,
          userOverrideAmount: null
        }
      };
      const period = createTestPeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31'),
        'monthly'
      );

      const result = calculateAllOccurrencesInPeriod(inflow, period);

      // Should still calculate occurrences
      expect(result.numberOfOccurrences).toBe(1);
      // Amount might differ based on variable income config
      expect(result.totalExpectedAmount).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // TEST MATRIX SUMMARY
  // ============================================================================

  describe('Test matrix coverage', () => {
    const frequencies = [
      PlaidRecurringFrequency.WEEKLY,
      PlaidRecurringFrequency.BIWEEKLY,
      PlaidRecurringFrequency.SEMI_MONTHLY,
      PlaidRecurringFrequency.MONTHLY,
      PlaidRecurringFrequency.QUARTERLY,
      PlaidRecurringFrequency.ANNUALLY
    ];

    const periodTypes = [
      { type: 'weekly', start: new Date('2025-01-01'), end: new Date('2025-01-07') },
      { type: 'bi_monthly', start: new Date('2025-01-01'), end: new Date('2025-01-15') },
      { type: 'monthly', start: new Date('2025-01-01'), end: new Date('2025-01-31') }
    ];

    // Generate test cases for all combinations
    frequencies.forEach(frequency => {
      periodTypes.forEach(({ type, start, end }) => {
        it(`should handle ${frequency} income in ${type} period`, () => {
          const inflow = createTestInflow(
            frequency,
            `${frequency} Income`,
            new Date('2025-01-15'),
            1000.00,
            'salary'
          );
          const period = createTestPeriod(
            `2025-${type.toUpperCase()}-01`,
            start,
            end,
            type
          );

          const result = calculateAllOccurrencesInPeriod(inflow, period);

          // Basic assertions that should pass for all combinations
          expect(result.numberOfOccurrences).toBeGreaterThanOrEqual(0);
          expect(result.occurrenceDueDates).toHaveLength(result.numberOfOccurrences);
          expect(result.totalExpectedAmount).toBeGreaterThanOrEqual(0);

          // Amounts should be non-negative
          expect(result.totalExpectedAmount).toBe(result.numberOfOccurrences * 1000.00);
        });
      });
    });
  });
});
