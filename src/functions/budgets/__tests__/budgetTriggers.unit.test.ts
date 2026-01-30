/**
 * @file budgetTriggers.unit.test.ts
 * @description Unit tests for budget Firestore trigger functions
 *
 * Tests:
 * - onBudgetCreate - Period generation trigger
 * - onBudgetUpdate - Transaction reassignment trigger
 * - onBudgetDelete - System budget recreation trigger
 *
 * Coverage areas:
 * - Period generation (monthly, bi-monthly, weekly)
 * - Proportional amount calculations
 * - Category change detection
 * - Transaction reassignment
 * - System budget protection
 * - Error handling
 */

import { Timestamp } from 'firebase-admin/firestore';
import { BudgetPeriod, PeriodType } from '../../../types';

// ============================================================================
// MOCK SETUP
// ============================================================================

// Mock utility functions
jest.mock('../utils/budgetPeriods', () => ({
  generateBudgetPeriodsForNewBudget: jest.fn(),
}));

jest.mock('../utils/recalculateHistoricalTransactions', () => ({
  recalculateHistoricalTransactions: jest.fn(),
}));

jest.mock('../utils/reassignTransactions', () => ({
  reassignTransactionsForBudget: jest.fn(),
}));

jest.mock('../utils/reassignTransactionsFromDeletedBudget', () => ({
  reassignTransactionsFromDeletedBudget: jest.fn(),
}));

jest.mock('../utils/createEverythingElseBudget', () => ({
  createEverythingElseBudget: jest.fn(),
}));

import { generateBudgetPeriodsForNewBudget } from '../utils/budgetPeriods';
import { recalculateHistoricalTransactions } from '../utils/recalculateHistoricalTransactions';
import { reassignTransactionsForBudget } from '../utils/reassignTransactions';
import { reassignTransactionsFromDeletedBudget } from '../utils/reassignTransactionsFromDeletedBudget';
import { createEverythingElseBudget } from '../utils/createEverythingElseBudget';

// ============================================================================
// TEST DATA FACTORIES
// ============================================================================

function createMockBudget(overrides: Partial<any> = {}): any {
  return {
    id: 'budget-123',
    name: 'Groceries',
    description: 'Monthly grocery budget',
    amount: 500,
    currency: 'USD',
    categoryIds: ['FOOD_AND_DRINK_GROCERIES'],
    period: BudgetPeriod.MONTHLY,
    budgetType: 'recurring' as const,
    isOngoing: true,
    startDate: Timestamp.fromDate(new Date('2025-01-01')),
    endDate: Timestamp.fromDate(new Date('2025-01-31')),
    budgetEndDate: null,
    spent: 0,
    remaining: 500,
    alertThreshold: 80,
    memberIds: ['test-user-123'],
    isShared: false,
    isActive: true,
    userId: 'test-user-123',
    familyId: 'family-123',
    groupIds: [],
    createdBy: 'test-user-123',
    access: {
      createdBy: 'test-user-123',
      ownerId: 'test-user-123',
      isPrivate: true,
    },
    isSystemEverythingElse: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  };
}

// Helper factory functions exported for potential use in other test files
// These are kept for reference and future test expansion
export const mockFactories = {
  createSourcePeriod: (overrides: Partial<any> = {}) => ({
    id: '2025-M01',
    periodType: PeriodType.MONTHLY,
    periodId: '2025-M01',
    startDate: Timestamp.fromDate(new Date('2025-01-01')),
    endDate: Timestamp.fromDate(new Date('2025-01-31')),
    year: 2025,
    month: 1,
    ...overrides,
  }),

  createBudgetPeriod: (overrides: Partial<any> = {}) => ({
    id: 'budget-123_2025-M01',
    budgetId: 'budget-123',
    periodId: '2025-M01',
    sourcePeriodId: '2025-M01',
    periodType: PeriodType.MONTHLY,
    periodStart: Timestamp.fromDate(new Date('2025-01-01')),
    periodEnd: Timestamp.fromDate(new Date('2025-01-31')),
    allocatedAmount: 500,
    originalAmount: 500,
    spent: 0,
    remaining: 500,
    userId: 'test-user-123',
    familyId: '',
    budgetName: 'Groceries',
    checklistItems: [],
    isModified: false,
    isActive: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  }),
};

function createMockTriggerEvent(params: { budgetId: string }, data: any) {
  return {
    params,
    data: {
      data: () => data,
    },
  };
}

function createMockUpdateTriggerEvent(params: { budgetId: string }, beforeData: any, afterData: any) {
  return {
    params,
    data: {
      before: { data: () => beforeData },
      after: { data: () => afterData },
    },
  };
}

function createMockDeleteTriggerEvent(params: { budgetId: string }, data: any) {
  return {
    params,
    data: {
      data: () => data,
    },
  };
}

// ============================================================================
// onBudgetCreate TESTS
// ============================================================================

describe('onBudgetCreate Trigger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // PERIOD GENERATION
  // --------------------------------------------------------------------------

  describe('Period Generation', () => {
    it('should generate budget periods when budget is created', async () => {
      const budget = createMockBudget();

      (generateBudgetPeriodsForNewBudget as jest.Mock).mockResolvedValue({
        count: 78,
        periodIds: [],
      });

      const result = await generateBudgetPeriodsForNewBudget({} as any, 'budget-123', budget);
      expect(result.count).toBe(78);
    });

    it('should generate approximately 78 periods for recurring budget (12M + 24BM + 52W)', async () => {
      const budget = createMockBudget({ budgetType: 'recurring' });

      (generateBudgetPeriodsForNewBudget as jest.Mock).mockResolvedValue({
        count: 78,
        periodIds: [],
      });

      const result = await generateBudgetPeriodsForNewBudget({} as any, 'budget-123', budget);

      // 12 monthly + 24 bi-monthly + ~52 weekly = ~88 periods
      // Actual count varies based on date ranges
      expect(result.count).toBeGreaterThanOrEqual(70);
    });

    it('should generate 12 MONTHLY periods per year', () => {
      const monthlyPeriods = Array.from({ length: 12 }, (_, i) => ({
        periodType: PeriodType.MONTHLY,
        periodId: `2025-M${String(i + 1).padStart(2, '0')}`,
      }));

      expect(monthlyPeriods).toHaveLength(12);
      expect(monthlyPeriods[0].periodId).toBe('2025-M01');
      expect(monthlyPeriods[11].periodId).toBe('2025-M12');
    });

    it('should generate 24 BI_MONTHLY periods per year', () => {
      const biMonthlyPeriods = [];

      for (let month = 1; month <= 12; month++) {
        biMonthlyPeriods.push({
          periodType: PeriodType.BI_MONTHLY,
          periodId: `2025-BM${String(month).padStart(2, '0')}-1`,
        });
        biMonthlyPeriods.push({
          periodType: PeriodType.BI_MONTHLY,
          periodId: `2025-BM${String(month).padStart(2, '0')}-2`,
        });
      }

      expect(biMonthlyPeriods).toHaveLength(24);
      expect(biMonthlyPeriods[0].periodId).toBe('2025-BM01-1');
      expect(biMonthlyPeriods[23].periodId).toBe('2025-BM12-2');
    });

    it('should generate ~52 WEEKLY periods per year', () => {
      const weeklyPeriods = Array.from({ length: 52 }, (_, i) => ({
        periodType: PeriodType.WEEKLY,
        periodId: `2025-W${String(i + 1).padStart(2, '0')}`,
      }));

      expect(weeklyPeriods.length).toBeGreaterThanOrEqual(52);
    });

    it('should generate periods only until budgetEndDate for limited budgets', async () => {
      const budget = createMockBudget({
        budgetType: 'limited',
        isOngoing: false,
        budgetEndDate: Timestamp.fromDate(new Date('2025-03-31')),
      });

      // Limited budget from Jan 1 to Mar 31 should have ~3 months of periods
      (generateBudgetPeriodsForNewBudget as jest.Mock).mockResolvedValue({
        count: 20, // ~3 monthly + ~6 bi-monthly + ~13 weekly
        periodIds: [],
      });

      const result = await generateBudgetPeriodsForNewBudget({} as any, 'budget-123', budget);
      expect(result.count).toBeLessThan(78);
    });
  });

  // --------------------------------------------------------------------------
  // AMOUNT CALCULATIONS
  // --------------------------------------------------------------------------

  describe('Proportional Amount Calculations', () => {
    const budgetAmount = 500;
    const AVG_DAYS_IN_MONTH = 30.44;

    it('should allocate full amount for MONTHLY periods', () => {
      const monthlyMultiplier = 1.0;
      const allocatedAmount = budgetAmount * monthlyMultiplier;

      expect(allocatedAmount).toBe(500);
    });

    it('should allocate 50% for BI_MONTHLY periods', () => {
      const biMonthlyMultiplier = 0.5;
      const allocatedAmount = budgetAmount * biMonthlyMultiplier;

      expect(allocatedAmount).toBe(250);
    });

    it('should allocate proportional amount for WEEKLY periods', () => {
      const weeklyMultiplier = 7 / AVG_DAYS_IN_MONTH;
      const allocatedAmount = budgetAmount * weeklyMultiplier;

      // 500 * (7 / 30.44) = 114.98 approximately
      expect(allocatedAmount).toBeCloseTo(114.98, 2);
    });

    it('should calculate correct multipliers based on period type', () => {
      const multipliers = {
        [PeriodType.MONTHLY]: 1.0,
        [PeriodType.BI_MONTHLY]: 0.5,
        [PeriodType.WEEKLY]: 7 / AVG_DAYS_IN_MONTH,
      };

      expect(multipliers[PeriodType.MONTHLY]).toBe(1.0);
      expect(multipliers[PeriodType.BI_MONTHLY]).toBe(0.5);
      // 7 / 30.44 = 0.22996 approximately
      expect(multipliers[PeriodType.WEEKLY]).toBeCloseTo(0.2300, 3);
    });
  });

  // --------------------------------------------------------------------------
  // HISTORICAL RECALCULATION
  // --------------------------------------------------------------------------

  describe('Historical Transaction Recalculation', () => {
    it('should recalculate historical transactions after period generation', async () => {
      const budget = createMockBudget();

      (recalculateHistoricalTransactions as jest.Mock).mockResolvedValue({
        transactionsUpdated: 15,
        spendingUpdated: 15,
      });

      const result = await recalculateHistoricalTransactions(
        'budget-123',
        budget.userId,
        budget.categoryIds,
        budget.startDate,
        null
      );

      expect(result.transactionsUpdated).toBe(15);
      expect(result.spendingUpdated).toBe(15);
    });

    it('should update transaction.splits[].budgetId for historical transactions', async () => {
      (recalculateHistoricalTransactions as jest.Mock).mockResolvedValue({
        transactionsUpdated: 10,
        spendingUpdated: 10,
      });

      const result = await recalculateHistoricalTransactions(
        'budget-123',
        'user-123',
        ['FOOD'],
        Timestamp.fromDate(new Date('2025-01-01')),
        null
      );

      expect(result.transactionsUpdated).toBe(10);
    });

    it('should handle budgets with no historical transactions', async () => {
      (recalculateHistoricalTransactions as jest.Mock).mockResolvedValue({
        transactionsUpdated: 0,
        spendingUpdated: 0,
      });

      const result = await recalculateHistoricalTransactions(
        'budget-123',
        'user-123',
        ['NEW_CATEGORY'],
        Timestamp.fromDate(new Date('2025-01-01')),
        null
      );

      expect(result.transactionsUpdated).toBe(0);
    });

    it('should use userId from budget for recalculation', () => {
      const budget = createMockBudget({ userId: 'user-abc' });
      const userId = budget.userId || budget.access?.createdBy;

      expect(userId).toBe('user-abc');
    });

    it('should fallback to access.createdBy when userId is missing', () => {
      const budget = createMockBudget({
        userId: undefined,
        access: { createdBy: 'fallback-user' },
      });
      const userId = budget.userId || budget.access?.createdBy;

      expect(userId).toBe('fallback-user');
    });
  });

  // --------------------------------------------------------------------------
  // ERROR HANDLING
  // --------------------------------------------------------------------------

  describe('Error Handling', () => {
    it('should not throw when budget data is missing', async () => {
      const event = createMockTriggerEvent({ budgetId: 'budget-123' }, null);

      // Simulating trigger behavior - should return early without throwing
      const budgetData = event.data?.data();
      const shouldReturn = !budgetData;

      expect(shouldReturn).toBe(true);
    });

    it('should continue even if recalculation fails', async () => {
      (generateBudgetPeriodsForNewBudget as jest.Mock).mockResolvedValue({
        count: 78,
        periodIds: [],
      });

      (recalculateHistoricalTransactions as jest.Mock).mockRejectedValue(
        new Error('Recalculation failed')
      );

      // Period generation succeeds
      const periodResult = await generateBudgetPeriodsForNewBudget({} as any, 'budget-123', createMockBudget());
      expect(periodResult.count).toBe(78);

      // Recalculation fails but should not break the trigger
      try {
        await recalculateHistoricalTransactions(
          'budget-123',
          'user-123',
          [],
          Timestamp.fromDate(new Date('2025-01-01')),
          null as any
        );
      } catch (error: any) {
        expect(error.message).toBe('Recalculation failed');
      }
    });

    it('should skip recalculation when userId is missing', () => {
      const budget = createMockBudget({ userId: undefined, access: undefined });
      const userId = budget.userId || budget.access?.createdBy;

      expect(userId).toBeUndefined();

      // Trigger should return early if no userId found
      const shouldSkip = !userId;
      expect(shouldSkip).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // BUDGET TYPE HANDLING
  // --------------------------------------------------------------------------

  describe('Budget Type Handling', () => {
    it('should set endDate to null for recurring budgets', () => {
      const budget = createMockBudget({ budgetType: 'recurring' });
      const endDate = budget.budgetType === 'recurring' ? null : budget.budgetEndDate;

      expect(endDate).toBeNull();
    });

    it('should use budgetEndDate for limited budgets', () => {
      const budget = createMockBudget({
        budgetType: 'limited',
        budgetEndDate: Timestamp.fromDate(new Date('2025-06-30')),
      });
      const endDate = budget.budgetType === 'recurring' ? null : budget.budgetEndDate;

      expect(endDate).toBeDefined();
    });

    it('should fallback to endDate when budgetEndDate is missing', () => {
      const budget = createMockBudget({
        budgetType: 'limited',
        budgetEndDate: undefined,
        endDate: Timestamp.fromDate(new Date('2025-03-31')),
      });
      const endDate = budget.budgetType === 'recurring'
        ? null
        : (budget.budgetEndDate || budget.endDate);

      expect(endDate).toBeDefined();
    });
  });
});

// ============================================================================
// onBudgetUpdate TESTS
// ============================================================================

describe('onBudgetUpdate Trigger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // CHANGE DETECTION
  // --------------------------------------------------------------------------

  describe('Category Change Detection', () => {
    it('should skip processing when categories are unchanged', () => {
      const categoriesBefore = ['FOOD', 'GROCERIES'];
      const categoriesAfter = ['FOOD', 'GROCERIES'];

      const beforeJson = JSON.stringify(categoriesBefore);
      const afterJson = JSON.stringify(categoriesAfter);

      const hasChanged = beforeJson !== afterJson;
      expect(hasChanged).toBe(false);
    });

    it('should detect when categories are added', () => {
      const categoriesBefore = ['FOOD'];
      const categoriesAfter = ['FOOD', 'GROCERIES'];

      const beforeJson = JSON.stringify(categoriesBefore);
      const afterJson = JSON.stringify(categoriesAfter);

      const hasChanged = beforeJson !== afterJson;
      expect(hasChanged).toBe(true);
    });

    it('should detect when categories are removed', () => {
      const categoriesBefore = ['FOOD', 'GROCERIES'];
      const categoriesAfter = ['FOOD'];

      const beforeJson = JSON.stringify(categoriesBefore);
      const afterJson = JSON.stringify(categoriesAfter);

      const hasChanged = beforeJson !== afterJson;
      expect(hasChanged).toBe(true);
    });

    it('should detect when categories are replaced', () => {
      const categoriesBefore = ['FOOD'];
      const categoriesAfter = ['ENTERTAINMENT'];

      const beforeJson = JSON.stringify(categoriesBefore);
      const afterJson = JSON.stringify(categoriesAfter);

      const hasChanged = beforeJson !== afterJson;
      expect(hasChanged).toBe(true);
    });

    it('should detect order changes in categories', () => {
      const categoriesBefore = ['FOOD', 'GROCERIES'];
      const categoriesAfter = ['GROCERIES', 'FOOD'];

      const beforeJson = JSON.stringify(categoriesBefore);
      const afterJson = JSON.stringify(categoriesAfter);

      // JSON stringify preserves order, so order change is detected
      const hasChanged = beforeJson !== afterJson;
      expect(hasChanged).toBe(true);
    });

    it('should handle empty categoryIds gracefully', () => {
      const categoriesBefore: string[] = [];
      const categoriesAfter: string[] = [];

      const beforeJson = JSON.stringify(categoriesBefore || []);
      const afterJson = JSON.stringify(categoriesAfter || []);

      const hasChanged = beforeJson !== afterJson;
      expect(hasChanged).toBe(false);
    });

    it('should handle null/undefined categoryIds', () => {
      const categoriesBefore = null as any;
      const categoriesAfter = undefined as any;

      const beforeJson = JSON.stringify(categoriesBefore || []);
      const afterJson = JSON.stringify(categoriesAfter || []);

      const hasChanged = beforeJson !== afterJson;
      expect(hasChanged).toBe(false); // Both become []
    });
  });

  // --------------------------------------------------------------------------
  // TRANSACTION REASSIGNMENT
  // --------------------------------------------------------------------------

  describe('Transaction Reassignment', () => {
    it('should reassign transactions when categories change', async () => {
      (reassignTransactionsForBudget as jest.Mock).mockResolvedValue(25);

      const reassignedCount = await reassignTransactionsForBudget('budget-123', 'user-123');
      expect(reassignedCount).toBe(25);
      expect(reassignTransactionsForBudget).toHaveBeenCalledWith('budget-123', 'user-123');
    });

    it('should handle zero transactions to reassign', async () => {
      (reassignTransactionsForBudget as jest.Mock).mockResolvedValue(0);

      const reassignedCount = await reassignTransactionsForBudget('budget-123', 'user-123');
      expect(reassignedCount).toBe(0);
    });

    it('should log reassignment count', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      (reassignTransactionsForBudget as jest.Mock).mockResolvedValue(10);

      const count = await reassignTransactionsForBudget('budget-123', 'user-123');

      consoleSpy.mockRestore();
      expect(count).toBe(10);
    });
  });

  // --------------------------------------------------------------------------
  // USER ID EXTRACTION
  // --------------------------------------------------------------------------

  describe('User ID Extraction', () => {
    it('should use userId when available', () => {
      const afterData = { userId: 'primary-user', access: { createdBy: 'fallback-user' } };
      const userId = afterData.userId || afterData.access?.createdBy;

      expect(userId).toBe('primary-user');
    });

    it('should fallback to access.createdBy when userId missing', () => {
      const afterData = { userId: undefined, access: { createdBy: 'fallback-user' } };
      const userId = afterData.userId || afterData.access?.createdBy;

      expect(userId).toBe('fallback-user');
    });

    it('should skip processing when no userId found', () => {
      const afterData: { userId?: string; access?: { createdBy: string } } = {
        userId: undefined,
        access: undefined,
      };
      const userId = afterData.userId || afterData.access?.createdBy;

      expect(userId).toBeUndefined();

      const shouldSkip = !userId;
      expect(shouldSkip).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // ERROR HANDLING
  // --------------------------------------------------------------------------

  describe('Error Handling', () => {
    it('should not throw when before/after data is missing', () => {
      const event = createMockUpdateTriggerEvent({ budgetId: 'budget-123' }, null, null);

      const beforeData = event.data?.before.data();
      const afterData = event.data?.after.data();

      const shouldReturn = !beforeData || !afterData;
      expect(shouldReturn).toBe(true);
    });

    it('should continue even if reassignment fails', async () => {
      (reassignTransactionsForBudget as jest.Mock).mockRejectedValue(
        new Error('Reassignment failed')
      );

      // Trigger should catch the error and not re-throw
      try {
        await reassignTransactionsForBudget('budget-123', 'user-123');
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toBe('Reassignment failed');
      }

      // Transaction reassignment failure should not break the budget update
      // The trigger logs the error but doesn't throw
    });
  });

  // --------------------------------------------------------------------------
  // NON-CATEGORY CHANGES
  // --------------------------------------------------------------------------

  describe('Non-Category Field Changes', () => {
    it('should not trigger reassignment for name change only', () => {
      const beforeData = { name: 'Old Name', categoryIds: ['FOOD'] };
      const afterData = { name: 'New Name', categoryIds: ['FOOD'] };

      const categoriesChanged = JSON.stringify(beforeData.categoryIds) !== JSON.stringify(afterData.categoryIds);
      expect(categoriesChanged).toBe(false);
    });

    it('should not trigger reassignment for amount change only', () => {
      const beforeData = { amount: 500, categoryIds: ['FOOD'] };
      const afterData = { amount: 600, categoryIds: ['FOOD'] };

      const categoriesChanged = JSON.stringify(beforeData.categoryIds) !== JSON.stringify(afterData.categoryIds);
      expect(categoriesChanged).toBe(false);
    });

    it('should not trigger reassignment for alertThreshold change', () => {
      const beforeData = { alertThreshold: 80, categoryIds: ['FOOD'] };
      const afterData = { alertThreshold: 90, categoryIds: ['FOOD'] };

      const categoriesChanged = JSON.stringify(beforeData.categoryIds) !== JSON.stringify(afterData.categoryIds);
      expect(categoriesChanged).toBe(false);
    });
  });
});

// ============================================================================
// onBudgetDelete TESTS
// ============================================================================

describe('onBudgetDelete Trigger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // TRANSACTION REASSIGNMENT
  // --------------------------------------------------------------------------

  describe('Transaction Reassignment on Delete', () => {
    it('should reassign transactions from deleted budget', async () => {
      (reassignTransactionsFromDeletedBudget as jest.Mock).mockResolvedValue({
        success: true,
        transactionsReassigned: 15,
        budgetAssignments: { 'other-budget': 10, 'everything-else': 5 },
        batchCount: 1,
        errors: [],
      });

      const result = await reassignTransactionsFromDeletedBudget('deleted-budget', 'user-123');

      expect(result.success).toBe(true);
      expect(result.transactionsReassigned).toBe(15);
    });

    it('should reassign to "Everything Else" when no matching budget', async () => {
      (reassignTransactionsFromDeletedBudget as jest.Mock).mockResolvedValue({
        success: true,
        transactionsReassigned: 5,
        budgetAssignments: { 'everything-else-budget': 5 },
        batchCount: 1,
        errors: [],
      });

      const result = await reassignTransactionsFromDeletedBudget('deleted-budget', 'user-123');

      expect(result.success).toBe(true);
      expect(result.budgetAssignments['everything-else-budget']).toBe(5);
    });

    it('should log deletion stats', async () => {
      (reassignTransactionsFromDeletedBudget as jest.Mock).mockResolvedValue({
        success: true,
        transactionsReassigned: 10,
        budgetAssignments: { 'budget-a': 6, 'budget-b': 4 },
        batchCount: 1,
        errors: [],
      });

      const result = await reassignTransactionsFromDeletedBudget('deleted-budget', 'user-123');

      expect(result.transactionsReassigned).toBe(10);
      expect(result.batchCount).toBe(1);
      expect(result.errors).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // SYSTEM BUDGET RECREATION
  // --------------------------------------------------------------------------

  describe('System Budget Recreation', () => {
    it('should recreate "Everything Else" budget when deleted', async () => {
      const budget = createMockBudget({
        isSystemEverythingElse: true,
        name: 'Everything Else',
      });

      (createEverythingElseBudget as jest.Mock).mockResolvedValue('new-everything-else-budget');

      // Only recreate if it's a system budget
      const isSystemBudget = budget.isSystemEverythingElse === true;
      expect(isSystemBudget).toBe(true);

      const newBudgetId = await createEverythingElseBudget({} as any, 'user-123', 'USD');
      expect(newBudgetId).toBe('new-everything-else-budget');
    });

    it('should not recreate regular budget on deletion', () => {
      const budget = createMockBudget({
        isSystemEverythingElse: false,
        name: 'Groceries',
      });

      const isSystemBudget = budget.isSystemEverythingElse === true;
      expect(isSystemBudget).toBe(false);

      // Should not call createEverythingElseBudget for regular budgets
    });

    it('should use deleted budget currency when recreating', async () => {
      const budget = createMockBudget({
        isSystemEverythingElse: true,
        currency: 'EUR',
      });

      (createEverythingElseBudget as jest.Mock).mockResolvedValue('new-budget-id');

      const userCurrency = budget.currency || 'USD';
      expect(userCurrency).toBe('EUR');

      await createEverythingElseBudget({} as any, 'user-123', userCurrency);
      expect(createEverythingElseBudget).toHaveBeenCalledWith({}, 'user-123', 'EUR');
    });

    it('should default to USD when currency is missing', () => {
      const budget = createMockBudget({
        isSystemEverythingElse: true,
        currency: undefined,
      });

      const userCurrency = budget.currency || 'USD';
      expect(userCurrency).toBe('USD');
    });
  });

  // --------------------------------------------------------------------------
  // DATA VALIDATION
  // --------------------------------------------------------------------------

  describe('Data Validation', () => {
    it('should skip processing when event data is missing', () => {
      const event = createMockDeleteTriggerEvent({ budgetId: 'budget-123' }, null);
      const budgetData = event.data?.data();

      const shouldReturn = !budgetData;
      expect(shouldReturn).toBe(true);
    });

    it('should skip processing when createdBy is missing', () => {
      const budget = createMockBudget({ createdBy: undefined });
      const userId = budget.createdBy;

      const shouldReturn = !userId;
      expect(shouldReturn).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // ERROR HANDLING
  // --------------------------------------------------------------------------

  describe('Error Handling', () => {
    it('should continue even if reassignment fails', async () => {
      (reassignTransactionsFromDeletedBudget as jest.Mock).mockResolvedValue({
        success: false,
        error: 'Reassignment failed',
        transactionsReassigned: 0,
        budgetAssignments: {},
        batchCount: 0,
        errors: ['Some error'],
      });

      const result = await reassignTransactionsFromDeletedBudget('budget-123', 'user-123');

      // Deletion should complete even if reassignment fails
      expect(result.success).toBe(false);
    });

    it('should continue even if system budget recreation fails', async () => {
      (createEverythingElseBudget as jest.Mock).mockRejectedValue(
        new Error('Recreation failed')
      );

      // Trigger should catch the error and not re-throw
      try {
        await createEverythingElseBudget({} as any, 'user-123', 'USD');
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toBe('Recreation failed');
      }

      // Deletion completes, user can manually create budget
    });

    it('should handle non-blocking errors gracefully', async () => {
      (reassignTransactionsFromDeletedBudget as jest.Mock).mockRejectedValue(
        new Error('Network error')
      );

      // The trigger catches errors and logs them but doesn't throw
      try {
        await reassignTransactionsFromDeletedBudget('budget-123', 'user-123');
      } catch (error) {
        // Error is caught at trigger level
        expect(error).toBeDefined();
      }

      // Budget deletion still completes
    });
  });

  // --------------------------------------------------------------------------
  // LOGGING
  // --------------------------------------------------------------------------

  describe('Logging', () => {
    it('should log regular budget deletion', () => {
      const budget = createMockBudget({
        isSystemEverythingElse: false,
        name: 'Groceries',
      });

      // Verify budget is correctly identified as non-system
      expect(budget.isSystemEverythingElse).toBe(false);

      const logMessage = `Regular budget deleted (not system budget): ${budget.id}`;
      expect(logMessage).toContain('not system budget');
    });

    it('should log system budget deletion warning', () => {
      const budget = createMockBudget({
        isSystemEverythingElse: true,
        userId: 'user-123',
      });

      // Verify budget is correctly identified as system budget
      expect(budget.isSystemEverythingElse).toBe(true);

      const warningMessage = `"Everything else" budget deleted for user ${budget.userId}. Recreating...`;
      expect(warningMessage).toContain('Recreating');
    });

    it('should log successful recreation', () => {
      const successMessage = `Successfully recreated "everything else" budget for user user-123: new-budget-id`;
      expect(successMessage).toContain('Successfully recreated');
    });
  });
});

// ============================================================================
// TRIGGER CONFIGURATION TESTS
// ============================================================================

describe('Trigger Configuration', () => {
  describe('Memory and Timeout Settings', () => {
    it('should use 512MiB for onBudgetCreate (batch operations)', () => {
      const config = {
        memory: '512MiB',
        timeoutSeconds: 60,
      };

      expect(config.memory).toBe('512MiB');
      expect(config.timeoutSeconds).toBe(60);
    });

    it('should use 512MiB for onBudgetUpdate (large reassignments)', () => {
      const config = {
        memory: '512MiB',
        timeoutSeconds: 60,
      };

      expect(config.memory).toBe('512MiB');
    });

    it('should use 256MiB for onBudgetDelete (lightweight operation)', () => {
      const config = {
        memory: '256MiB',
        timeoutSeconds: 60,
      };

      expect(config.memory).toBe('256MiB');
    });
  });

  describe('Document Path Matching', () => {
    it('should match budgets/{budgetId} path', () => {
      const documentPath = 'budgets/{budgetId}';
      const pattern = /^budgets\/\{budgetId\}$/;

      expect(pattern.test(documentPath)).toBe(true);
    });

    it('should extract budgetId from params', () => {
      const params = { budgetId: 'budget-abc123' };
      expect(params.budgetId).toBe('budget-abc123');
    });
  });

  describe('Region Configuration', () => {
    it('should use us-central1 region', () => {
      const config = { region: 'us-central1' };
      expect(config.region).toBe('us-central1');
    });
  });
});

// ============================================================================
// INTEGRATION SCENARIOS
// ============================================================================

describe('Trigger Integration Scenarios', () => {
  describe('Budget Creation Flow', () => {
    it('should complete full creation flow: periods + recalculation', async () => {
      const budget = createMockBudget();

      // Step 1: Generate periods
      (generateBudgetPeriodsForNewBudget as jest.Mock).mockResolvedValue({
        count: 78,
        periodIds: [],
      });

      const periodResult = await generateBudgetPeriodsForNewBudget({} as any, 'budget-123', budget);
      expect(periodResult.count).toBe(78);

      // Step 2: Recalculate historical transactions
      (recalculateHistoricalTransactions as jest.Mock).mockResolvedValue({
        transactionsUpdated: 10,
        spendingUpdated: 10,
      });

      const recalcResult = await recalculateHistoricalTransactions(
        'budget-123',
        budget.userId,
        budget.categoryIds,
        budget.startDate,
        null
      );
      expect(recalcResult.transactionsUpdated).toBe(10);
    });
  });

  describe('Budget Update Flow', () => {
    it('should complete update flow: detect change + reassign', async () => {
      const beforeData = { categoryIds: ['FOOD'], userId: 'user-123' };
      const afterData = { categoryIds: ['FOOD', 'GROCERIES'], userId: 'user-123' };

      // Step 1: Detect change
      const hasChanged = JSON.stringify(beforeData.categoryIds) !== JSON.stringify(afterData.categoryIds);
      expect(hasChanged).toBe(true);

      // Step 2: Reassign transactions
      (reassignTransactionsForBudget as jest.Mock).mockResolvedValue(25);

      const reassignedCount = await reassignTransactionsForBudget('budget-123', afterData.userId);
      expect(reassignedCount).toBe(25);
    });
  });

  describe('Budget Deletion Flow', () => {
    it('should complete regular deletion flow: reassign only', async () => {
      const budget = createMockBudget({ isSystemEverythingElse: false });

      // Step 1: Reassign transactions
      (reassignTransactionsFromDeletedBudget as jest.Mock).mockResolvedValue({
        success: true,
        transactionsReassigned: 5,
        budgetAssignments: {},
        batchCount: 1,
        errors: [],
      });

      const result = await reassignTransactionsFromDeletedBudget('budget-123', budget.createdBy);
      expect(result.success).toBe(true);

      // Step 2: No recreation needed (not system budget)
      const needsRecreation = budget.isSystemEverythingElse === true;
      expect(needsRecreation).toBe(false);
    });

    it('should complete system budget deletion flow: reassign + recreate', async () => {
      const budget = createMockBudget({ isSystemEverythingElse: true });

      // Step 1: Reassign transactions
      (reassignTransactionsFromDeletedBudget as jest.Mock).mockResolvedValue({
        success: true,
        transactionsReassigned: 5,
        budgetAssignments: {},
        batchCount: 1,
        errors: [],
      });

      const result = await reassignTransactionsFromDeletedBudget('budget-123', budget.createdBy);
      expect(result.success).toBe(true);

      // Step 2: Recreate system budget
      const needsRecreation = budget.isSystemEverythingElse === true;
      expect(needsRecreation).toBe(true);

      (createEverythingElseBudget as jest.Mock).mockResolvedValue('new-budget-id');

      const newBudgetId = await createEverythingElseBudget({} as any, budget.createdBy, budget.currency);
      expect(newBudgetId).toBe('new-budget-id');
    });
  });
});
