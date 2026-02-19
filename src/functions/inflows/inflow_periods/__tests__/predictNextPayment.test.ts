/**
 * Unit Tests for predictNextPayment (Inflows)
 *
 * Tests the payment prediction logic for various income types:
 * - Regular salary (biweekly, semi-monthly, monthly)
 * - Variable income (hourly, commission)
 * - Periodic bonuses (annual, quarterly)
 *
 * Verifies:
 * - Correct next payment date calculation
 * - Proper handling of frequency intervals
 * - Variable income amount prediction (rolling average, user override)
 * - Commission and bonus schedule handling
 * - Weekend/holiday adjustments (optional)
 *
 * NOTE: This test file is created BEFORE implementation (Test-First Development)
 */

import { Timestamp } from 'firebase-admin/firestore';
import {
  Inflow,
  PlaidRecurringFrequency
} from '../../../../types';

// Import the actual implementation
import {
  predictNextPayment,
  predictPaymentsInPeriod,
  PaymentPrediction
} from '../utils/predictNextPayment';

describe('predictNextPayment', () => {
  // Helper to create a timezone-safe date at noon UTC
  const createUTCDate = (year: number, month: number, day: number): Date => {
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  };

  // Helper to create test inflow
  const createTestInflow = (
    frequency: PlaidRecurringFrequency,
    lastDate: Date,
    averageAmount: number = 2000.00,
    predictedNextDate?: Date,
    options: {
      incomeType?: string;
      isVariable?: boolean;
      isActive?: boolean;
      variableIncomeConfig?: any;
      bonusConfig?: any;
      commissionConfig?: any;
    } = {}
  ): Partial<Inflow> => {
    // Compute incomeType first so isRegularSalary can reference the resolved value
    const incomeType = options.incomeType || 'salary';
    return {
      id: 'test_inflow',
      description: 'Test Income',
      frequency,
      firstDate: Timestamp.fromDate(createUTCDate(2024, 1, 1)),
      lastDate: Timestamp.fromDate(lastDate),
      predictedNextDate: predictedNextDate ? Timestamp.fromDate(predictedNextDate) : null,
      averageAmount,
      incomeType,
      isRegularSalary: incomeType === 'salary',
      isVariable: options.isVariable || false,
      variableIncomeConfig: options.variableIncomeConfig,
      bonusConfig: options.bonusConfig,
      commissionConfig: options.commissionConfig,
      isActive: options.isActive !== false, // Default true unless explicitly false
      source: 'plaid'
    } as Partial<Inflow>;
  };

  // ============================================================================
  // REGULAR SALARY PREDICTION TESTS
  // ============================================================================

  describe('Regular salary prediction', () => {
    it('should predict next weekly payment correctly', () => {
      const lastPayday = createUTCDate(2025, 1, 3); // Friday
      const inflow = createTestInflow(
        PlaidRecurringFrequency.WEEKLY,
        lastPayday,
        800.00
      );

      const fromDate = createUTCDate(2025, 1, 6); // Monday after payday
      const result = predictNextPayment(inflow, fromDate);

      // Next Friday should be Jan 10
      expect(result).not.toBeNull();
      expect(result!.expectedDate.toDate().getUTCDate()).toBe(10);
      expect(result!.expectedAmount).toBe(800.00);
      expect(result!.confidenceLevel).toBe('high');
    });

    it('should predict next biweekly payment correctly', () => {
      const lastPayday = createUTCDate(2025, 1, 3); // Friday
      const inflow = createTestInflow(
        PlaidRecurringFrequency.BIWEEKLY,
        lastPayday,
        2000.00
      );

      const fromDate = createUTCDate(2025, 1, 6); // Monday after payday
      const result = predictNextPayment(inflow, fromDate);

      // Next payday should be Jan 17 (14 days after Jan 3)
      expect(result).not.toBeNull();
      const predictedDate = result!.expectedDate.toDate();
      expect(predictedDate.getUTCDate()).toBe(17);
      expect(result!.expectedAmount).toBe(2000.00);
    });

    it('should predict next semi-monthly payment correctly', () => {
      const lastPayday = createUTCDate(2025, 1, 1); // 1st of month
      const inflow = createTestInflow(
        PlaidRecurringFrequency.SEMI_MONTHLY,
        lastPayday,
        2500.00
      );

      const fromDate = createUTCDate(2025, 1, 5);
      const result = predictNextPayment(inflow, fromDate);

      // Next payday should be around 15th (Jan 1 + 15 days = Jan 16)
      expect(result).not.toBeNull();
      const predictedDate = result!.expectedDate.toDate();
      expect(predictedDate.getUTCDate()).toBeGreaterThanOrEqual(15);
      expect(predictedDate.getUTCDate()).toBeLessThanOrEqual(17);
      expect(result!.expectedAmount).toBe(2500.00);
    });

    it('should predict next monthly payment correctly', () => {
      const lastPayday = createUTCDate(2025, 1, 15);
      const inflow = createTestInflow(
        PlaidRecurringFrequency.MONTHLY,
        lastPayday,
        5000.00
      );

      const fromDate = createUTCDate(2025, 1, 20);
      const result = predictNextPayment(inflow, fromDate);

      // Next payday should be Feb 15
      expect(result).not.toBeNull();
      const predictedDate = result!.expectedDate.toDate();
      expect(predictedDate.getUTCMonth()).toBe(1); // February (0-indexed)
      expect(predictedDate.getUTCDate()).toBe(15);
      expect(result!.expectedAmount).toBe(5000.00);
    });

    it('should use Plaid predictedNextDate when available', () => {
      const lastPayday = createUTCDate(2025, 1, 3);
      const plaidPrediction = createUTCDate(2025, 1, 17);
      const inflow = createTestInflow(
        PlaidRecurringFrequency.BIWEEKLY,
        lastPayday,
        2000.00,
        plaidPrediction
      );

      const fromDate = createUTCDate(2025, 1, 6); // Before the prediction date
      const result = predictNextPayment(inflow, fromDate);

      // Should use Plaid's prediction
      expect(result).not.toBeNull();
      expect(result!.expectedDate.toDate().getUTCDate()).toBe(17);
      expect(result!.predictionMethod).toBe('plaid');
      expect(result!.confidenceLevel).toBe('high');
    });

    it('should fall back to frequency calculation when Plaid prediction unavailable', () => {
      const lastPayday = createUTCDate(2025, 1, 3);
      const inflow = createTestInflow(
        PlaidRecurringFrequency.BIWEEKLY,
        lastPayday,
        2000.00,
        undefined // No Plaid prediction
      );

      const fromDate = createUTCDate(2025, 1, 6);
      const result = predictNextPayment(inflow, fromDate);

      // Should calculate based on frequency
      expect(result).not.toBeNull();
      const predictedDate = result!.expectedDate.toDate();
      expect(predictedDate.getUTCDate()).toBe(17); // Jan 3 + 14 days
      expect(result!.predictionMethod).toBe('frequency');
    });
  });

  // ============================================================================
  // VARIABLE INCOME PREDICTION TESTS
  // ============================================================================

  describe('Variable income prediction', () => {
    it('should use user override amount when provided', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.MONTHLY,
        new Date('2025-01-15'),
        3000.00, // Plaid average
        undefined,
        {
          incomeType: 'commission',
          isVariable: true,
          variableIncomeConfig: {
            useRollingAverage: false,
            rollingAveragePeriods: 3,
            userOverrideAmount: 4000.00 // User's estimate
          }
        }
      );

      const result = predictNextPayment(inflow);

      expect(result).not.toBeNull();
      expect(result!.expectedAmount).toBe(4000.00);
      expect(result!.predictionMethod).toBe('user_override');
      expect(result!.confidenceLevel).toBe('medium'); // Lower confidence for user estimate
    });

    it('should use rolling average when configured', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.MONTHLY,
        new Date('2025-01-15'),
        3000.00, // This represents the rolling average from Plaid
        undefined,
        {
          incomeType: 'hourly',
          isVariable: true,
          variableIncomeConfig: {
            useRollingAverage: true,
            rollingAveragePeriods: 3,
            userOverrideAmount: null
          }
        }
      );

      const result = predictNextPayment(inflow);

      expect(result).not.toBeNull();
      expect(result!.expectedAmount).toBe(3000.00);
      expect(result!.predictionMethod).toBe('rolling_average');
      expect(result!.confidenceLevel).toBe('medium');
    });

    it('should fall back to Plaid average when no config', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.MONTHLY,
        new Date('2025-01-15'),
        3000.00,
        undefined,
        {
          incomeType: 'freelance',
          isVariable: true
        }
      );

      const result = predictNextPayment(inflow);

      expect(result).not.toBeNull();
      expect(result!.expectedAmount).toBe(3000.00);
      expect(result!.predictionMethod).toBe('frequency');
    });

    it('should have lower confidence for variable income', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.MONTHLY,
        new Date('2025-01-15'),
        3000.00,
        undefined,
        {
          incomeType: 'hourly',
          isVariable: true
        }
      );

      const result = predictNextPayment(inflow);

      expect(result).not.toBeNull();
      expect(['medium', 'low']).toContain(result!.confidenceLevel);
    });
  });

  // ============================================================================
  // COMMISSION PREDICTION TESTS
  // ============================================================================

  describe('Commission prediction', () => {
    it('should predict monthly commission payment', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.MONTHLY,
        createUTCDate(2025, 1, 20), // Commission paid on 20th
        5000.00,
        undefined,
        {
          incomeType: 'commission',
          commissionConfig: {
            schedule: 'monthly',
            expectedPaymentDay: 20,
            basePlusCommission: false
          }
        }
      );

      const fromDate = createUTCDate(2025, 1, 25);
      const result = predictNextPayment(inflow, fromDate);

      // Next commission should be Feb 20
      expect(result).not.toBeNull();
      const predictedDate = result!.expectedDate.toDate();
      expect(predictedDate.getUTCMonth()).toBe(1); // February (0-indexed)
      expect(predictedDate.getUTCDate()).toBe(20);
    });

    it('should predict quarterly commission payment', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.QUARTERLY,
        createUTCDate(2025, 1, 15), // Q4 2024 commission paid in Jan
        15000.00,
        undefined,
        {
          incomeType: 'commission',
          commissionConfig: {
            schedule: 'quarterly',
            expectedPaymentDay: 15,
            basePlusCommission: false
          }
        }
      );

      const fromDate = createUTCDate(2025, 2, 1);
      const result = predictNextPayment(inflow, fromDate);

      // Next quarterly commission should be April 15
      expect(result).not.toBeNull();
      const predictedDate = result!.expectedDate.toDate();
      expect(predictedDate.getUTCMonth()).toBe(3); // April (0-indexed)
      expect(predictedDate.getUTCDate()).toBe(15);
    });

    it('should handle base + commission salary', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.MONTHLY,
        createUTCDate(2025, 1, 15),
        8000.00, // Total: 5000 base + 3000 commission
        undefined,
        {
          incomeType: 'commission',
          commissionConfig: {
            schedule: 'monthly',
            expectedPaymentDay: 15,
            basePlusCommission: true,
            baseAmount: 5000
          }
        }
      );

      const fromDate = createUTCDate(2025, 1, 20);
      const result = predictNextPayment(inflow, fromDate);

      // Should use total amount for prediction
      expect(result).not.toBeNull();
      expect(result!.expectedAmount).toBe(8000.00);
    });
  });

  // ============================================================================
  // BONUS PREDICTION TESTS
  // ============================================================================

  describe('Bonus prediction', () => {
    it('should predict annual bonus payment', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.ANNUALLY,
        new Date('2024-12-15'), // Last year's bonus
        20000.00,
        undefined,
        {
          incomeType: 'bonus',
          bonusConfig: {
            schedule: 'annual',
            expectedMonth: 12, // December
            lastBonusAmount: 20000.00,
            lastBonusDate: Timestamp.fromDate(new Date('2024-12-15'))
          }
        }
      );

      const fromDate = new Date('2025-06-01');
      const result = predictNextPayment(inflow, fromDate);

      // Next annual bonus should be Dec 2025
      expect(result).not.toBeNull();
      const predictedDate = result!.expectedDate.toDate();
      expect(predictedDate.getMonth()).toBe(11); // December
      expect(predictedDate.getFullYear()).toBe(2025);
    });

    it('should predict quarterly bonus payment', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.QUARTERLY,
        new Date('2025-01-15'), // Q4 2024 bonus
        5000.00,
        undefined,
        {
          incomeType: 'bonus',
          bonusConfig: {
            schedule: 'quarterly',
            expectedQuarter: 1 // Current quarter
          }
        }
      );

      const fromDate = new Date('2025-02-01');
      const result = predictNextPayment(inflow, fromDate);

      // Next quarterly bonus should be around April
      expect(result).not.toBeNull();
      const predictedDate = result!.expectedDate.toDate();
      expect(predictedDate.getMonth()).toBe(3); // April
    });

    it('should have lower confidence for bonus prediction', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.ANNUALLY,
        new Date('2024-12-15'),
        20000.00,
        undefined,
        {
          incomeType: 'bonus',
          bonusConfig: {
            schedule: 'annual',
            expectedMonth: 12
          }
        }
      );

      const result = predictNextPayment(inflow);

      // Bonuses are less predictable
      expect(result).not.toBeNull();
      expect(['medium', 'low']).toContain(result!.confidenceLevel);
    });
  });

  // ============================================================================
  // IN-PERIOD PREDICTION TESTS
  // ============================================================================

  describe('predictPaymentsInPeriod', () => {
    it('should predict all weekly payments in a monthly period', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.WEEKLY,
        new Date('2025-01-03'),
        800.00
      );

      const periodStart = new Date('2025-01-01');
      const periodEnd = new Date('2025-01-31');

      const result = predictPaymentsInPeriod(inflow, periodStart, periodEnd);

      // Should have 4-5 payments in January
      expect(result.length).toBeGreaterThanOrEqual(4);
      expect(result.length).toBeLessThanOrEqual(5);

      // All dates should be within period
      result.forEach((prediction: PaymentPrediction) => {
        const date = prediction.expectedDate.toDate();
        expect(date >= periodStart).toBe(true);
        expect(date <= periodEnd).toBe(true);
      });

      // All should be marked as in-period
      result.forEach((prediction: PaymentPrediction) => {
        expect(prediction.isInPeriod).toBe(true);
      });
    });

    it('should predict biweekly payments in monthly period', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.BIWEEKLY,
        new Date('2025-01-03'),
        2000.00
      );

      const periodStart = new Date('2025-01-01');
      const periodEnd = new Date('2025-01-31');

      const result = predictPaymentsInPeriod(inflow, periodStart, periodEnd);

      // Should have 2-3 payments
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it('should predict single monthly payment in monthly period', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.MONTHLY,
        new Date('2025-01-15'),
        5000.00
      );

      const periodStart = new Date('2025-02-01');
      const periodEnd = new Date('2025-02-28');

      const result = predictPaymentsInPeriod(inflow, periodStart, periodEnd);

      // Should have exactly 1 payment
      expect(result.length).toBe(1);
      expect(result[0].expectedDate.toDate().getMonth()).toBe(1); // February
    });

    it('should return empty array when no payments expected in period', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.ANNUALLY,
        new Date('2024-12-15'), // December bonus
        20000.00
      );

      const periodStart = new Date('2025-06-01');
      const periodEnd = new Date('2025-06-30'); // June, not December

      const result = predictPaymentsInPeriod(inflow, periodStart, periodEnd);

      expect(result.length).toBe(0);
    });

    it('should predict multiple payments types correctly in same period', () => {
      const biweeklySalary = createTestInflow(
        PlaidRecurringFrequency.BIWEEKLY,
        new Date('2025-01-03'),
        2000.00,
        undefined,
        { incomeType: 'salary' }
      );

      const periodStart = new Date('2025-01-01');
      const periodEnd = new Date('2025-01-31');

      const salaryResult = predictPaymentsInPeriod(biweeklySalary, periodStart, periodEnd);

      // Should get 2-3 salary payments
      expect(salaryResult.length).toBeGreaterThanOrEqual(2);

      // Each should have correct amount
      salaryResult.forEach((prediction: PaymentPrediction) => {
        expect(prediction.expectedAmount).toBe(2000.00);
      });
    });
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Edge cases', () => {
    it('should handle month-end dates crossing into shorter months', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.MONTHLY,
        createUTCDate(2025, 1, 31), // Paid on 31st
        5000.00
      );

      const fromDate = createUTCDate(2025, 2, 1);
      const result = predictNextPayment(inflow, fromDate);

      // Should predict a date in February (day may vary due to month-end handling)
      expect(result).not.toBeNull();
      const predictedDate = result!.expectedDate.toDate();
      expect(predictedDate.getUTCMonth()).toBe(1); // February (0-indexed)
      expect(predictedDate.getUTCDate()).toBeLessThanOrEqual(28);
    });

    it('should handle weekend adjustments (optional)', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.MONTHLY,
        new Date('2025-01-11'), // Saturday
        5000.00
      );

      const result = predictNextPayment(inflow);

      // Depending on implementation, may adjust to Friday or Monday
      expect(result).not.toBeNull();
      const dayOfWeek = result!.expectedDate.toDate().getDay();
      // 0 = Sunday, 6 = Saturday
      expect(dayOfWeek).not.toBe(0);
      expect(dayOfWeek).not.toBe(6);
    });

    it('should calculate correct days until payment', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.WEEKLY,
        new Date('2025-01-03'), // Last Friday
        800.00,
        new Date('2025-01-10') // Next Friday (Plaid prediction)
      );

      const fromDate = new Date('2025-01-07'); // Tuesday
      const result = predictNextPayment(inflow, fromDate);

      // From Tuesday to Friday = 3 days
      expect(result).not.toBeNull();
      expect(result!.daysUntilPayment).toBe(3);
    });

    it('should handle payment date in the past (just happened)', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.WEEKLY,
        new Date('2025-01-03'),
        800.00,
        new Date('2025-01-10')
      );

      // Query after the predicted date
      const fromDate = new Date('2025-01-12'); // After Jan 10
      const result = predictNextPayment(inflow, fromDate);

      // Should calculate next occurrence (Jan 17)
      expect(result).not.toBeNull();
      const predictedDate = result!.expectedDate.toDate();
      expect(predictedDate >= fromDate).toBe(true);
    });

    it('should handle inactive income (return null or skip)', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.MONTHLY,
        createUTCDate(2025, 1, 15),
        5000.00,
        undefined,
        { isActive: false }
      );

      const result = predictNextPayment(inflow);

      // Inactive income should not predict future payments
      // Implementation choice: return null, throw, or return with flag
      expect(result).toBeNull();
    });
  });

  // ============================================================================
  // CONFIDENCE LEVEL TESTS
  // ============================================================================

  describe('Confidence levels', () => {
    it('should return high confidence for regular salary with Plaid prediction', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.BIWEEKLY,
        new Date('2025-01-03'),
        2000.00,
        new Date('2025-01-17'),
        { incomeType: 'salary' }
      );

      const result = predictNextPayment(inflow);

      expect(result).not.toBeNull();
      expect(result!.confidenceLevel).toBe('high');
    });

    it('should return medium confidence for variable income', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.MONTHLY,
        new Date('2025-01-15'),
        3000.00,
        undefined,
        {
          incomeType: 'hourly',
          isVariable: true
        }
      );

      const result = predictNextPayment(inflow);

      expect(result).not.toBeNull();
      expect(result!.confidenceLevel).toBe('medium');
    });

    it('should return low confidence for infrequent bonus', () => {
      const inflow = createTestInflow(
        PlaidRecurringFrequency.ANNUALLY,
        new Date('2024-12-15'),
        20000.00,
        undefined,
        {
          incomeType: 'bonus',
          bonusConfig: {
            schedule: 'performance' // Performance-based = unpredictable
          }
        }
      );

      const result = predictNextPayment(inflow);

      expect(result).not.toBeNull();
      expect(result!.confidenceLevel).toBe('low');
    });
  });
});
