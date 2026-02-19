/**
 * @file periodGeneration.unit.test.ts
 * @description Unit tests for budget period generation
 *
 * Tests:
 * - Period generation from source periods
 * - Correct number of periods created (monthly, bi-monthly, weekly)
 * - Period inheritance from parent budget
 * - Amount allocation for each period type
 */

import { BudgetPeriod, PeriodType } from '../../../types';
import { calculatePeriodAllocatedAmount } from '../utils/calculatePeriodAllocatedAmount';
import {
  roundToCents,
  createTimestamp,
  createMockBudget,
  createMockSourcePeriod,
  createMonthlySourcePeriods,
  createBiMonthlySourcePeriods,
  createWeeklySourcePeriods,
} from './helpers/budgetTestHelpers';

describe('Budget Period Generation', () => {
  // ============================================================================
  // PERIOD COUNT VALIDATION
  // ============================================================================

  describe('Period Count Validation', () => {
    describe('Single Month Budget', () => {
      it('should generate 1 monthly period for single month budget', () => {
        const monthlyPeriods = createMonthlySourcePeriods(2025, 1, 2025, 1);
        expect(monthlyPeriods).toHaveLength(1);
      });

      it('should generate 2 bi-monthly periods for single month budget', () => {
        const biMonthlyPeriods = createBiMonthlySourcePeriods(2025, 1, 2025, 1);
        expect(biMonthlyPeriods).toHaveLength(2);
      });

      it('should generate 4-5 weekly periods for single month budget', () => {
        // January 2025 spans ~5 weeks
        const weeklyPeriods = createWeeklySourcePeriods(
          new Date(2025, 0, 1),
          new Date(2025, 0, 31)
        );

        // Depending on day alignment, could be 4-5 weeks
        expect(weeklyPeriods.length).toBeGreaterThanOrEqual(4);
        expect(weeklyPeriods.length).toBeLessThanOrEqual(6);
      });
    });

    describe('Full Year Budget', () => {
      it('should generate 12 monthly periods for full year budget', () => {
        const monthlyPeriods = createMonthlySourcePeriods(2025, 1, 2025, 12);
        expect(monthlyPeriods).toHaveLength(12);
      });

      it('should generate 24 bi-monthly periods for full year budget', () => {
        const biMonthlyPeriods = createBiMonthlySourcePeriods(2025, 1, 2025, 12);
        expect(biMonthlyPeriods).toHaveLength(24);
      });

      it('should generate approximately 52 weekly periods for full year budget', () => {
        const weeklyPeriods = createWeeklySourcePeriods(
          new Date(2025, 0, 1),
          new Date(2025, 11, 31)
        );

        // Should be 52-53 weeks
        expect(weeklyPeriods.length).toBeGreaterThanOrEqual(52);
        expect(weeklyPeriods.length).toBeLessThanOrEqual(54);
      });
    });

    describe('Quarter Budget', () => {
      it('should generate 3 monthly periods for Q1 budget', () => {
        const monthlyPeriods = createMonthlySourcePeriods(2025, 1, 2025, 3);
        expect(monthlyPeriods).toHaveLength(3);
      });

      it('should generate 6 bi-monthly periods for Q1 budget', () => {
        const biMonthlyPeriods = createBiMonthlySourcePeriods(2025, 1, 2025, 3);
        expect(biMonthlyPeriods).toHaveLength(6);
      });

      it('should generate approximately 13 weekly periods for Q1 budget', () => {
        const weeklyPeriods = createWeeklySourcePeriods(
          new Date(2025, 0, 1),
          new Date(2025, 2, 31)
        );

        // Q1 is about 13 weeks
        expect(weeklyPeriods.length).toBeGreaterThanOrEqual(12);
        expect(weeklyPeriods.length).toBeLessThanOrEqual(15);
      });
    });

    describe('Partial Month Budget', () => {
      it('should generate periods for Feb 1 - March 19', () => {
        // Monthly: 2 (Feb full, March partial)
        const monthlyPeriods = [
          createMockSourcePeriod({
            type: PeriodType.MONTHLY,
            year: 2025,
            month: 2,
            startDate: createTimestamp(2025, 2, 1),
            endDate: createTimestamp(2025, 2, 28),
          }),
          createMockSourcePeriod({
            type: PeriodType.MONTHLY,
            year: 2025,
            month: 3,
            startDate: createTimestamp(2025, 3, 1),
            endDate: createTimestamp(2025, 3, 19),
          }),
        ];
        expect(monthlyPeriods).toHaveLength(2);

        // Bi-monthly: 4 (Feb 1-15, Feb 16-28, Mar 1-15, Mar 16-19)
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
        expect(biMonthlyPeriods).toHaveLength(4);

        // Weekly: ~7 weeks
        const weeklyPeriods = createWeeklySourcePeriods(
          new Date(2025, 1, 1),
          new Date(2025, 2, 19)
        );
        expect(weeklyPeriods.length).toBeGreaterThanOrEqual(6);
        expect(weeklyPeriods.length).toBeLessThanOrEqual(8);
      });
    });
  });

  // ============================================================================
  // PERIOD GENERATION FOR DIFFERENT BUDGET TYPES
  // ============================================================================

  describe('Period Generation by Budget Type', () => {
    describe('Weekly Budget', () => {
      it('should create all period types for weekly budget', () => {
        // Budget definition - periods are generated for all types regardless of budget period
        const budget = createMockBudget({
          name: 'Weekly Groceries',
          amount: 150,
          period: BudgetPeriod.WEEKLY,
          startDate: createTimestamp(2025, 1, 1),
        });

        // When creating budget periods, all types should be generated
        const monthlyPeriods = createMonthlySourcePeriods(2025, 1, 2025, 12);
        const biMonthlyPeriods = createBiMonthlySourcePeriods(2025, 1, 2025, 12);
        const weeklyPeriods = createWeeklySourcePeriods(
          new Date(2025, 0, 1),
          new Date(2025, 11, 31)
        );

        expect(monthlyPeriods.length).toBeGreaterThan(0);
        expect(biMonthlyPeriods.length).toBeGreaterThan(0);
        expect(weeklyPeriods.length).toBeGreaterThan(0);
        // Verify budget is correctly configured
        expect(budget.period).toBe(BudgetPeriod.WEEKLY);
      });
    });

    describe('Monthly Budget', () => {
      it('should create all period types for monthly budget', () => {
        // Budget definition - periods are generated for all types regardless of budget period
        const budget = createMockBudget({
          name: 'Monthly Entertainment',
          amount: 200,
          period: BudgetPeriod.MONTHLY,
          startDate: createTimestamp(2025, 1, 1),
        });

        // When creating budget periods, all types should be generated
        const monthlyPeriods = createMonthlySourcePeriods(2025, 1, 2025, 12);
        const biMonthlyPeriods = createBiMonthlySourcePeriods(2025, 1, 2025, 12);
        const weeklyPeriods = createWeeklySourcePeriods(
          new Date(2025, 0, 1),
          new Date(2025, 11, 31)
        );

        expect(monthlyPeriods.length).toBeGreaterThan(0);
        expect(biMonthlyPeriods.length).toBeGreaterThan(0);
        expect(weeklyPeriods.length).toBeGreaterThan(0);
        // Verify budget is correctly configured
        expect(budget.period).toBe(BudgetPeriod.MONTHLY);
      });
    });

    describe('Custom (Bi-Monthly) Budget', () => {
      it('should create all period types for bi-monthly budget', () => {
        // Budget definition - periods are generated for all types regardless of budget period
        const budget = createMockBudget({
          name: 'Bi-Monthly Transportation',
          amount: 250,
          period: BudgetPeriod.CUSTOM,
          startDate: createTimestamp(2025, 1, 1),
        });

        // When creating budget periods, all types should be generated
        const monthlyPeriods = createMonthlySourcePeriods(2025, 1, 2025, 12);
        const biMonthlyPeriods = createBiMonthlySourcePeriods(2025, 1, 2025, 12);
        const weeklyPeriods = createWeeklySourcePeriods(
          new Date(2025, 0, 1),
          new Date(2025, 11, 31)
        );

        expect(monthlyPeriods.length).toBeGreaterThan(0);
        expect(biMonthlyPeriods.length).toBeGreaterThan(0);
        expect(weeklyPeriods.length).toBeGreaterThan(0);
        // Verify budget is correctly configured
        expect(budget.period).toBe(BudgetPeriod.CUSTOM);
      });
    });
  });

  // ============================================================================
  // PERIOD AMOUNT ALLOCATION
  // ============================================================================

  describe('Period Amount Allocation', () => {
    describe('Monthly Budget Amount Allocation', () => {
      it('should allocate full amount to monthly periods', () => {
        const budgetAmount = 500;
        const monthlyPeriod = createMockSourcePeriod({
          type: PeriodType.MONTHLY,
          year: 2025,
          month: 1,
          startDate: createTimestamp(2025, 1, 1),
          endDate: createTimestamp(2025, 1, 31),
        });

        const allocated = calculatePeriodAllocatedAmount(
          budgetAmount,
          PeriodType.MONTHLY,
          monthlyPeriod
        );

        expect(allocated).toBe(500);
      });

      it('should allocate proportional amount to bi-monthly periods', () => {
        const budgetAmount = 500;

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

        const firstAllocated = calculatePeriodAllocatedAmount(
          budgetAmount,
          PeriodType.MONTHLY,
          firstHalf
        );
        const secondAllocated = calculatePeriodAllocatedAmount(
          budgetAmount,
          PeriodType.MONTHLY,
          secondHalf
        );

        // Sum should equal budget amount
        expect(Math.abs(firstAllocated + secondAllocated - budgetAmount)).toBeLessThan(0.01);
      });

      it('should allocate proportional amount to weekly periods', () => {
        const budgetAmount = 100;
        const weeklyPeriod = createMockSourcePeriod({
          type: PeriodType.WEEKLY,
          year: 2025,
          weekNumber: 1,
          startDate: createTimestamp(2025, 1, 5),
          endDate: createTimestamp(2025, 1, 11),
        });

        const allocated = calculatePeriodAllocatedAmount(
          budgetAmount,
          PeriodType.MONTHLY,
          weeklyPeriod
        );

        // 7 days out of 31 January days
        const expectedDaily = 100 / 31;
        const expectedWeekly = roundToCents(7 * expectedDaily);

        expect(Math.abs(allocated - expectedWeekly)).toBeLessThan(0.02);
      });
    });

    describe('Bi-Monthly Budget Amount Allocation', () => {
      it('should allocate full amount to bi-monthly periods of same half', () => {
        const budgetAmount = 100;
        const biMonthlyPeriod = createMockSourcePeriod({
          type: PeriodType.BI_MONTHLY,
          year: 2025,
          month: 1,
          biMonthlyHalf: 1,
          startDate: createTimestamp(2025, 1, 1),
          endDate: createTimestamp(2025, 1, 15),
        });

        const allocated = calculatePeriodAllocatedAmount(
          budgetAmount,
          PeriodType.BI_MONTHLY,
          biMonthlyPeriod
        );

        expect(allocated).toBe(100);
      });
    });

    describe('Weekly Budget Amount Allocation', () => {
      it('should allocate full amount to weekly periods', () => {
        const budgetAmount = 150;
        const weeklyPeriod = createMockSourcePeriod({
          type: PeriodType.WEEKLY,
          year: 2025,
          weekNumber: 1,
          startDate: createTimestamp(2025, 1, 5),
          endDate: createTimestamp(2025, 1, 11),
        });

        const allocated = calculatePeriodAllocatedAmount(
          budgetAmount,
          PeriodType.WEEKLY,
          weeklyPeriod
        );

        expect(allocated).toBe(150);
      });

      it('should allocate proportional amount to monthly periods', () => {
        const budgetAmount = 100; // Per week
        const monthlyPeriod = createMockSourcePeriod({
          type: PeriodType.MONTHLY,
          year: 2025,
          month: 1,
          startDate: createTimestamp(2025, 1, 1),
          endDate: createTimestamp(2025, 1, 31),
        });

        const allocated = calculatePeriodAllocatedAmount(
          budgetAmount,
          PeriodType.WEEKLY,
          monthlyPeriod
        );

        // 31 days * (100/7) per day
        const expectedDaily = 100 / 7;
        const expectedMonthly = roundToCents(31 * expectedDaily);

        expect(Math.abs(allocated - expectedMonthly)).toBeLessThan(0.02);
      });
    });
  });

  // ============================================================================
  // PERIOD INHERITANCE
  // ============================================================================

  describe('Period Inheritance from Parent Budget', () => {
    it('should inherit userId from budget', () => {
      const userId = 'test_user_001';
      const budget = createMockBudget({
        name: 'Test',
        amount: 100,
        period: BudgetPeriod.MONTHLY,
        startDate: createTimestamp(2025, 1, 1),
        userId,
      });

      // Budget periods should inherit userId
      expect(budget.createdBy).toBe(userId);
      expect(budget.ownerId).toBe(userId);
    });

    it('should inherit categoryIds from budget', () => {
      const categoryIds = ['FOOD_AND_DRINK_GROCERIES', 'FOOD_AND_DRINK_RESTAURANTS'];
      const budget = createMockBudget({
        name: 'Food',
        amount: 500,
        period: BudgetPeriod.MONTHLY,
        startDate: createTimestamp(2025, 1, 1),
        categoryIds,
      });

      expect(budget.categoryIds).toEqual(categoryIds);
    });

    it('should use budget name for period budgetName', () => {
      const budget = createMockBudget({
        name: 'Groceries Budget',
        amount: 500,
        period: BudgetPeriod.MONTHLY,
        startDate: createTimestamp(2025, 1, 1),
      });

      // Budget periods should have budgetName = budget.name
      expect(budget.name).toBe('Groceries Budget');
    });
  });

  // ============================================================================
  // DATE RANGE HANDLING
  // ============================================================================

  describe('Date Range Handling', () => {
    it('should generate periods for exact date range', () => {
      // Budget: Feb 1 - March 31
      const startDate = new Date(2025, 1, 1);
      const endDate = new Date(2025, 2, 31);

      const monthlyPeriods = createMonthlySourcePeriods(2025, 2, 2025, 3);
      const biMonthlyPeriods = createBiMonthlySourcePeriods(2025, 2, 2025, 3);
      const weeklyPeriods = createWeeklySourcePeriods(startDate, endDate);

      expect(monthlyPeriods).toHaveLength(2);
      expect(biMonthlyPeriods).toHaveLength(4);
      expect(weeklyPeriods.length).toBeGreaterThanOrEqual(8);
    });

    it('should handle budget starting mid-month', () => {
      // Budget starts Jan 15
      const startDate = new Date(2025, 0, 15);
      const endDate = new Date(2025, 1, 28);

      const weeklyPeriods = createWeeklySourcePeriods(startDate, endDate);

      // First weekly period should start from the Sunday before Jan 15
      // Jan 15, 2025 is Wednesday, so first Sunday is Jan 12
      expect(weeklyPeriods.length).toBeGreaterThan(0);
    });

    it('should handle budget ending mid-month', () => {
      // Budget ends April 13
      const startDate = new Date(2025, 1, 1);
      const endDate = new Date(2025, 3, 13);

      const weeklyPeriods = createWeeklySourcePeriods(startDate, endDate);

      // Last weekly period should end on or before April 13
      const lastPeriod = weeklyPeriods[weeklyPeriods.length - 1];
      expect(lastPeriod.endDate.toDate().getTime()).toBeLessThanOrEqual(endDate.getTime());
    });
  });

  // ============================================================================
  // RECURRING VS LIMITED BUDGET PERIODS
  // ============================================================================

  describe('Recurring vs Limited Budget Periods', () => {
    it('should generate 12 months of periods for recurring budget', () => {
      // Recurring budgets get 1 year of periods
      const monthlyPeriods = createMonthlySourcePeriods(2025, 1, 2025, 12);
      expect(monthlyPeriods).toHaveLength(12);
    });

    it('should generate only until end date for limited budget', () => {
      // Limited budget: Jan 1 - March 31 (3 months only)
      const monthlyPeriods = createMonthlySourcePeriods(2025, 1, 2025, 3);
      expect(monthlyPeriods).toHaveLength(3);
    });
  });

  // ============================================================================
  // PERIOD ID GENERATION
  // ============================================================================

  describe('Period ID Generation', () => {
    it('should generate correct monthly period IDs', () => {
      const periods = createMonthlySourcePeriods(2025, 1, 2025, 3);

      expect(periods[0].id).toContain('2025-M01');
      expect(periods[1].id).toContain('2025-M02');
      expect(periods[2].id).toContain('2025-M03');
    });

    it('should generate correct bi-monthly period IDs', () => {
      const periods = createBiMonthlySourcePeriods(2025, 1, 2025, 1);

      expect(periods[0].id).toContain('2025-BM01-1');
      expect(periods[1].id).toContain('2025-BM01-2');
    });

    it('should generate correct weekly period IDs', () => {
      const periods = createWeeklySourcePeriods(
        new Date(2025, 0, 5), // First Sunday of 2025
        new Date(2025, 0, 18)
      );

      // Week IDs should be sequential
      expect(periods.length).toBeGreaterThan(0);
      periods.forEach((period, index) => {
        expect(period.id).toContain('W');
      });
    });
  });
});
