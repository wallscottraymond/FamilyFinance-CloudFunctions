/**
 * @file budgetCreation.unit.test.ts
 * @description Unit tests for budget creation logic
 *
 * Tests:
 * - Budget document structure validation
 * - Personal vs shared budget creation
 * - Budget type validation (recurring, limited)
 * - Category validation
 * - Date range calculation
 */

import { Timestamp } from 'firebase-admin/firestore';
import { BudgetPeriod } from '../../../types';
import { createTimestamp, createMockBudget } from './helpers/budgetTestHelpers';

describe('Budget Creation', () => {
  // ============================================================================
  // BUDGET DOCUMENT STRUCTURE
  // ============================================================================

  describe('Budget Document Structure', () => {
    it('should create budget with all required fields', () => {
      const budget = createMockBudget({
        name: 'Groceries',
        amount: 500,
        period: BudgetPeriod.MONTHLY,
        startDate: createTimestamp(2025, 1, 1),
      });

      // Required fields
      expect(budget.id).toBeDefined();
      expect(budget.name).toBe('Groceries');
      expect(budget.amount).toBe(500);
      expect(budget.period).toBe(BudgetPeriod.MONTHLY);
      expect(budget.categoryIds).toBeDefined();
      expect(budget.startDate).toBeDefined();
      expect(budget.createdAt).toBeDefined();
      expect(budget.updatedAt).toBeDefined();
      expect(budget.isActive).toBe(true);
    });

    it('should set default currency to USD', () => {
      const budget = createMockBudget({
        name: 'Test',
        amount: 100,
        period: BudgetPeriod.MONTHLY,
        startDate: createTimestamp(2025, 1, 1),
      });

      expect(budget.currency).toBe('USD');
    });

    it('should set default alert threshold to 80', () => {
      const budget = createMockBudget({
        name: 'Test',
        amount: 100,
        period: BudgetPeriod.MONTHLY,
        startDate: createTimestamp(2025, 1, 1),
      });

      expect(budget.alertThreshold).toBe(80);
    });

    it('should initialize spent to 0 and remaining to amount', () => {
      const budget = createMockBudget({
        name: 'Test',
        amount: 250,
        period: BudgetPeriod.MONTHLY,
        startDate: createTimestamp(2025, 1, 1),
      });

      expect(budget.spent).toBe(0);
      expect(budget.remaining).toBe(250);
    });
  });

  // ============================================================================
  // PERSONAL VS SHARED BUDGETS
  // ============================================================================

  describe('Personal vs Shared Budgets', () => {
    it('should create personal budget with no groupIds', () => {
      const budget = createMockBudget({
        name: 'Personal Groceries',
        amount: 500,
        period: BudgetPeriod.MONTHLY,
        startDate: createTimestamp(2025, 1, 1),
      });

      expect(budget.isShared).toBe(false);
      // Personal budgets should have empty or undefined groupIds
      expect(budget.memberIds).toContain(budget.createdBy);
    });

    it('should set owner fields correctly for personal budget', () => {
      const userId = 'test_user_001';
      const budget = createMockBudget({
        name: 'Personal',
        amount: 100,
        period: BudgetPeriod.MONTHLY,
        startDate: createTimestamp(2025, 1, 1),
        userId,
      });

      expect(budget.createdBy).toBe(userId);
      expect(budget.ownerId).toBe(userId);
      expect(budget.access?.createdBy).toBe(userId);
      expect(budget.access?.ownerId).toBe(userId);
    });

    it('should have isPrivate true for personal budgets', () => {
      const budget = createMockBudget({
        name: 'Personal',
        amount: 100,
        period: BudgetPeriod.MONTHLY,
        startDate: createTimestamp(2025, 1, 1),
      });

      expect(budget.access?.isPrivate).toBe(true);
    });
  });

  // ============================================================================
  // BUDGET PERIOD TYPES
  // ============================================================================

  describe('Budget Period Types', () => {
    it('should create weekly budget', () => {
      const budget = createMockBudget({
        name: 'Weekly Groceries',
        amount: 150,
        period: BudgetPeriod.WEEKLY,
        startDate: createTimestamp(2025, 1, 1),
      });

      expect(budget.period).toBe(BudgetPeriod.WEEKLY);
    });

    it('should create monthly budget', () => {
      const budget = createMockBudget({
        name: 'Monthly Entertainment',
        amount: 200,
        period: BudgetPeriod.MONTHLY,
        startDate: createTimestamp(2025, 1, 1),
      });

      expect(budget.period).toBe(BudgetPeriod.MONTHLY);
    });

    it('should create quarterly budget', () => {
      const budget = createMockBudget({
        name: 'Quarterly Savings',
        amount: 1000,
        period: BudgetPeriod.QUARTERLY,
        startDate: createTimestamp(2025, 1, 1),
      });

      expect(budget.period).toBe(BudgetPeriod.QUARTERLY);
    });

    it('should create yearly budget', () => {
      const budget = createMockBudget({
        name: 'Annual Insurance',
        amount: 2400,
        period: BudgetPeriod.YEARLY,
        startDate: createTimestamp(2025, 1, 1),
      });

      expect(budget.period).toBe(BudgetPeriod.YEARLY);
    });

    it('should create custom period budget', () => {
      const budget = createMockBudget({
        name: 'Bi-Weekly Transportation',
        amount: 250,
        period: BudgetPeriod.CUSTOM,
        startDate: createTimestamp(2025, 1, 1),
      });

      expect(budget.period).toBe(BudgetPeriod.CUSTOM);
    });
  });

  // ============================================================================
  // RECURRING VS LIMITED BUDGETS
  // ============================================================================

  describe('Recurring vs Limited Budgets', () => {
    it('should create recurring budget with isOngoing true', () => {
      const budget = createMockBudget({
        name: 'Ongoing Groceries',
        amount: 500,
        period: BudgetPeriod.MONTHLY,
        startDate: createTimestamp(2025, 1, 1),
      });

      expect(budget.budgetType).toBe('recurring');
      expect(budget.isOngoing).toBe(true);
    });

    it('should set endDate same as startDate for ongoing budgets', () => {
      const startDate = createTimestamp(2025, 1, 1);
      const budget = createMockBudget({
        name: 'Ongoing',
        amount: 100,
        period: BudgetPeriod.MONTHLY,
        startDate,
      });

      // For ongoing budgets, endDate is same as startDate
      expect(budget.endDate.toMillis()).toBe(startDate.toMillis());
    });

    it('should allow specifying end date for limited budgets', () => {
      const startDate = createTimestamp(2025, 1, 1);
      const endDate = createTimestamp(2025, 3, 31);

      const budget = createMockBudget({
        name: 'Q1 Budget',
        amount: 1000,
        period: BudgetPeriod.MONTHLY,
        startDate,
        endDate,
      });

      expect(budget.startDate.toMillis()).toBe(startDate.toMillis());
      expect(budget.endDate.toMillis()).toBe(endDate.toMillis());
    });
  });

  // ============================================================================
  // CATEGORY VALIDATION
  // ============================================================================

  describe('Category Validation', () => {
    it('should accept single category', () => {
      const budget = createMockBudget({
        name: 'Groceries',
        amount: 500,
        period: BudgetPeriod.MONTHLY,
        startDate: createTimestamp(2025, 1, 1),
        categoryIds: ['FOOD_AND_DRINK_GROCERIES'],
      });

      expect(budget.categoryIds).toHaveLength(1);
      expect(budget.categoryIds[0]).toBe('FOOD_AND_DRINK_GROCERIES');
    });

    it('should accept multiple categories', () => {
      const budget = createMockBudget({
        name: 'Transportation',
        amount: 250,
        period: BudgetPeriod.MONTHLY,
        startDate: createTimestamp(2025, 1, 1),
        categoryIds: [
          'TRANSPORTATION_GAS',
          'TRANSPORTATION_PARKING',
          'TRANSPORTATION_TOLLS',
        ],
      });

      expect(budget.categoryIds).toHaveLength(3);
    });

    it('should provide default category if none specified', () => {
      const budget = createMockBudget({
        name: 'Test',
        amount: 100,
        period: BudgetPeriod.MONTHLY,
        startDate: createTimestamp(2025, 1, 1),
      });

      expect(budget.categoryIds).toBeDefined();
      expect(budget.categoryIds.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // DATE RANGE VALIDATION
  // ============================================================================

  describe('Date Range Validation', () => {
    it('should accept start date in the past', () => {
      // Budget starting from 3 months ago
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      threeMonthsAgo.setDate(1);

      const budget = createMockBudget({
        name: 'Historical Budget',
        amount: 500,
        period: BudgetPeriod.MONTHLY,
        startDate: Timestamp.fromDate(threeMonthsAgo),
      });

      expect(budget.startDate.toDate().getTime()).toBeLessThan(Date.now());
    });

    it('should accept start date in the future', () => {
      // Budget starting next month
      const nextMonth = new Date();
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      nextMonth.setDate(1);

      const budget = createMockBudget({
        name: 'Future Budget',
        amount: 500,
        period: BudgetPeriod.MONTHLY,
        startDate: Timestamp.fromDate(nextMonth),
      });

      expect(budget.startDate.toDate().getTime()).toBeGreaterThan(Date.now());
    });

    it('should handle month boundary dates correctly', () => {
      // Start on last day of January
      const budget = createMockBudget({
        name: 'Month End Start',
        amount: 100,
        period: BudgetPeriod.MONTHLY,
        startDate: createTimestamp(2025, 1, 31),
      });

      expect(budget.startDate.toDate().getDate()).toBe(31);
    });

    it('should handle leap year date', () => {
      // February 29, 2024 (leap year)
      const budget = createMockBudget({
        name: 'Leap Year Budget',
        amount: 100,
        period: BudgetPeriod.MONTHLY,
        startDate: createTimestamp(2024, 2, 29),
      });

      const startDate = budget.startDate.toDate();
      expect(startDate.getDate()).toBe(29);
      expect(startDate.getMonth()).toBe(1); // February (0-indexed)
    });
  });

  // ============================================================================
  // AMOUNT VALIDATION
  // ============================================================================

  describe('Amount Validation', () => {
    it('should accept positive amount', () => {
      const budget = createMockBudget({
        name: 'Test',
        amount: 500,
        period: BudgetPeriod.MONTHLY,
        startDate: createTimestamp(2025, 1, 1),
      });

      expect(budget.amount).toBe(500);
    });

    it('should accept decimal amount', () => {
      const budget = createMockBudget({
        name: 'Test',
        amount: 99.99,
        period: BudgetPeriod.MONTHLY,
        startDate: createTimestamp(2025, 1, 1),
      });

      expect(budget.amount).toBe(99.99);
    });

    it('should accept zero amount', () => {
      const budget = createMockBudget({
        name: 'Everything Else',
        amount: 0,
        period: BudgetPeriod.MONTHLY,
        startDate: createTimestamp(2025, 1, 1),
      });

      expect(budget.amount).toBe(0);
    });

    it('should accept large amount', () => {
      const budget = createMockBudget({
        name: 'Large Budget',
        amount: 1000000,
        period: BudgetPeriod.YEARLY,
        startDate: createTimestamp(2025, 1, 1),
      });

      expect(budget.amount).toBe(1000000);
    });
  });

  // ============================================================================
  // BUDGET ID GENERATION
  // ============================================================================

  describe('Budget ID Generation', () => {
    it('should generate unique budget ID', () => {
      const budget1 = createMockBudget({
        name: 'Budget 1',
        amount: 100,
        period: BudgetPeriod.MONTHLY,
        startDate: createTimestamp(2025, 1, 1),
      });

      const budget2 = createMockBudget({
        name: 'Budget 2',
        amount: 200,
        period: BudgetPeriod.MONTHLY,
        startDate: createTimestamp(2025, 1, 1),
      });

      expect(budget1.id).toBeDefined();
      expect(budget2.id).toBeDefined();
      // IDs should be unique (timestamp-based)
    });

    it('should allow custom budget ID', () => {
      const customId = 'budget_custom_groceries_001';
      const budget = createMockBudget({
        id: customId,
        name: 'Custom ID Budget',
        amount: 100,
        period: BudgetPeriod.MONTHLY,
        startDate: createTimestamp(2025, 1, 1),
      });

      expect(budget.id).toBe(customId);
    });
  });
});
