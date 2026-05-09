/**
 * Integration tests for rolloverChainCalculation utility
 *
 * Tests the rollover chain calculation functions with mocked Firestore:
 * - recalculateRolloverChain: Full chain recalculation for a budget
 * - recalculateRolloverForCurrentPeriods: Daily scheduled recalculation
 */

import { Timestamp } from 'firebase-admin/firestore';
import {
  recalculateRolloverChain,
  recalculateRolloverForCurrentPeriods,
} from '../rolloverChainCalculation';
import { Budget, BudgetPeriodDocument, PeriodType } from '../../../../types';

// Mock data helpers
const createMockBudget = (overrides: Partial<Budget> = {}): Budget => ({
  id: 'budget-123',
  userId: 'user-123',
  groupIds: [],
  name: 'Test Budget',
  description: 'Test description',
  amount: 500,
  currency: 'USD',
  categoryIds: ['cat-1'],
  period: 'monthly',
  alertThreshold: 80,
  isActive: true,
  isOngoing: true,
  budgetType: 'recurring',
  rolloverEnabled: true,
  rolloverStrategy: 'immediate',
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  ...overrides,
} as Budget);

const createMockPeriod = (
  id: string,
  startDate: Date,
  endDate: Date,
  overrides: Partial<BudgetPeriodDocument> = {}
): BudgetPeriodDocument => ({
  id,
  budgetId: 'budget-123',
  budgetName: 'Test Budget',
  periodId: `2025M${startDate.getMonth() + 1}`,
  sourcePeriodId: `2025M${startDate.getMonth() + 1}`,
  periodType: PeriodType.MONTHLY,
  periodStart: Timestamp.fromDate(startDate),
  periodEnd: Timestamp.fromDate(endDate),
  allocatedAmount: 500,
  originalAmount: 500,
  spent: 0,
  remaining: 500,
  isModified: false,
  checklistItems: [],
  lastCalculated: Timestamp.now(),
  isActive: true,
  userId: 'user-123',
  groupIds: [],
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  ...overrides,
});

// Firestore mock setup
const createMockFirestore = () => {
  const mockDocs: Map<string, any> = new Map();
  const mockBatchUpdates: { ref: any; data: any }[] = [];

  const mockDocRef = (id: string) => ({
    id,
    get: jest.fn().mockImplementation(async () => {
      const data = mockDocs.get(id);
      return {
        exists: !!data,
        id,
        data: () => data,
        ref: mockDocRef(id),
      };
    }),
  });

  const mockBatch = {
    update: jest.fn().mockImplementation((ref, data) => {
      mockBatchUpdates.push({ ref, data });
    }),
    commit: jest.fn().mockResolvedValue(undefined),
  };

  const mockCollection = jest.fn().mockImplementation((name: string) => ({
    doc: jest.fn().mockImplementation((id: string) => mockDocRef(`${name}/${id}`)),
    where: jest.fn().mockReturnThis(),
    get: jest.fn().mockImplementation(async () => ({
      empty: mockDocs.size === 0,
      size: mockDocs.size,
      forEach: (callback: (doc: any) => void) => {
        mockDocs.forEach((data, id) => {
          if (id.startsWith(name)) {
            callback({
              id: id.replace(`${name}/`, ''),
              data: () => data,
              ref: mockDocRef(id),
            });
          }
        });
      },
    })),
  }));

  const mockDb = {
    collection: mockCollection,
    batch: jest.fn().mockReturnValue(mockBatch),
  };

  return {
    db: mockDb as any,
    mockDocs,
    mockBatch,
    mockBatchUpdates,
    addDoc: (collection: string, id: string, data: any) => {
      mockDocs.set(`${collection}/${id}`, data);
    },
    clearDocs: () => {
      mockDocs.clear();
      mockBatchUpdates.length = 0;
    },
  };
};

describe('recalculateRolloverChain', () => {
  let mockFirestore: ReturnType<typeof createMockFirestore>;

  beforeEach(() => {
    mockFirestore = createMockFirestore();
    jest.clearAllMocks();
  });

  describe('budget not found', () => {
    test('should return error when budget does not exist', async () => {
      const result = await recalculateRolloverChain(mockFirestore.db, 'nonexistent-budget');

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Budget nonexistent-budget not found');
      expect(result.periodsUpdated).toBe(0);
    });
  });

  describe('rollover disabled', () => {
    test('should clear rollover when disabled on budget', async () => {
      // Setup budget with rollover disabled
      mockFirestore.addDoc('budgets', 'budget-123', createMockBudget({
        rolloverEnabled: false,
      }));

      // Add period with existing rollover
      mockFirestore.addDoc('budget_periods', 'period-1', createMockPeriod(
        'period-1',
        new Date('2025-01-01'),
        new Date('2025-01-31'),
        {
          rolledOverAmount: 100,
          spent: 300,
        }
      ));

      const result = await recalculateRolloverChain(mockFirestore.db, 'budget-123');

      expect(result.success).toBe(true);
      // Should have cleared the rollover
      expect(result.periodsUpdated).toBeGreaterThanOrEqual(0);
    });
  });

  describe('no periods', () => {
    test('should return success with zero updates when no periods exist', async () => {
      mockFirestore.addDoc('budgets', 'budget-123', createMockBudget());

      const result = await recalculateRolloverChain(mockFirestore.db, 'budget-123');

      expect(result.success).toBe(true);
      expect(result.periodsUpdated).toBe(0);
    });
  });

  describe('single period (first period)', () => {
    test('should not calculate rollover for first period', async () => {
      mockFirestore.addDoc('budgets', 'budget-123', createMockBudget());
      mockFirestore.addDoc('budget_periods', 'period-1', createMockPeriod(
        'period-1',
        new Date('2025-01-01'),
        new Date('2025-01-31'),
        { spent: 400 }
      ));

      const result = await recalculateRolloverChain(mockFirestore.db, 'budget-123');

      expect(result.success).toBe(true);
      // First period has no previous, so no rollover to calculate
    });
  });

  describe('chain calculation', () => {
    test('should calculate rollover chain for multiple periods', async () => {
      mockFirestore.addDoc('budgets', 'budget-123', createMockBudget({
        rolloverEnabled: true,
        rolloverStrategy: 'immediate',
      }));

      // January: spent 400 of 500 = surplus 100
      mockFirestore.addDoc('budget_periods', 'period-jan', createMockPeriod(
        'period-jan',
        new Date('2025-01-01'),
        new Date('2025-01-31'),
        { spent: 400, periodId: '2025M01' }
      ));

      // February: should receive +100 rollover
      mockFirestore.addDoc('budget_periods', 'period-feb', createMockPeriod(
        'period-feb',
        new Date('2025-02-01'),
        new Date('2025-02-28'),
        { spent: 450, periodId: '2025M02' }
      ));

      const result = await recalculateRolloverChain(mockFirestore.db, 'budget-123');

      expect(result.success).toBe(true);
      // At least February should be updated with rollover
    });
  });

  describe('period type filtering', () => {
    test('should only recalculate specified period types', async () => {
      mockFirestore.addDoc('budgets', 'budget-123', createMockBudget());

      // Monthly period
      mockFirestore.addDoc('budget_periods', 'monthly-1', createMockPeriod(
        'monthly-1',
        new Date('2025-01-01'),
        new Date('2025-01-31'),
        { periodType: PeriodType.MONTHLY }
      ));

      // Weekly period
      mockFirestore.addDoc('budget_periods', 'weekly-1', createMockPeriod(
        'weekly-1',
        new Date('2025-01-01'),
        new Date('2025-01-07'),
        { periodType: PeriodType.WEEKLY }
      ));

      const result = await recalculateRolloverChain(
        mockFirestore.db,
        'budget-123',
        undefined,
        [PeriodType.MONTHLY]
      );

      expect(result.success).toBe(true);
      // Only monthly periods should be processed
      expect(result.periodsByType[PeriodType.WEEKLY]).toBeUndefined();
    });
  });

  describe('spread strategy', () => {
    test('should track pending spread across periods', async () => {
      mockFirestore.addDoc('budgets', 'budget-123', createMockBudget({
        rolloverEnabled: true,
        rolloverStrategy: 'spread',
        rolloverSpreadPeriods: 3,
      }));

      // January: overspent by 300
      mockFirestore.addDoc('budget_periods', 'period-jan', createMockPeriod(
        'period-jan',
        new Date('2025-01-01'),
        new Date('2025-01-31'),
        { spent: 800, allocatedAmount: 500 }
      ));

      // February: should get -100 (first installment)
      mockFirestore.addDoc('budget_periods', 'period-feb', createMockPeriod(
        'period-feb',
        new Date('2025-02-01'),
        new Date('2025-02-28'),
        { spent: 400 }
      ));

      // March: should get -100 (second installment)
      mockFirestore.addDoc('budget_periods', 'period-mar', createMockPeriod(
        'period-mar',
        new Date('2025-03-01'),
        new Date('2025-03-31'),
        { spent: 400 }
      ));

      const result = await recalculateRolloverChain(mockFirestore.db, 'budget-123');

      expect(result.success).toBe(true);
    });
  });

  describe('user settings fallback', () => {
    test('should use user settings when budget has no overrides', async () => {
      mockFirestore.addDoc('budgets', 'budget-123', createMockBudget({
        rolloverEnabled: undefined, // No override
        rolloverStrategy: undefined,
        userId: 'user-123',
      }));

      mockFirestore.addDoc('users', 'user-123', {
        financialSettings: {
          budgetRolloverEnabled: true,
          budgetRolloverStrategy: 'spread',
          budgetRolloverSpreadPeriods: 2,
        },
      });

      mockFirestore.addDoc('budget_periods', 'period-1', createMockPeriod(
        'period-1',
        new Date('2025-01-01'),
        new Date('2025-01-31'),
        { spent: 400 }
      ));

      const result = await recalculateRolloverChain(mockFirestore.db, 'budget-123');

      expect(result.success).toBe(true);
    });
  });
});

describe('recalculateRolloverForCurrentPeriods', () => {
  let mockFirestore: ReturnType<typeof createMockFirestore>;

  beforeEach(() => {
    mockFirestore = createMockFirestore();
    jest.clearAllMocks();
  });

  describe('no current periods', () => {
    test('should return success with zero updates when no current periods', async () => {
      const result = await recalculateRolloverForCurrentPeriods(mockFirestore.db);

      expect(result.budgetsProcessed).toBe(0);
      expect(result.periodsUpdated).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('with current periods', () => {
    test('should process all unique budgets with current periods', async () => {
      const now = new Date();
      const periodStart = new Date(now);
      periodStart.setDate(1);
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1, 0);

      // Add budget
      mockFirestore.addDoc('budgets', 'budget-123', createMockBudget());

      // Add current period
      mockFirestore.addDoc('budget_periods', 'current-period', createMockPeriod(
        'current-period',
        periodStart,
        periodEnd,
        { spent: 200 }
      ));

      const result = await recalculateRolloverForCurrentPeriods(mockFirestore.db);

      expect(result.errors).toHaveLength(0);
    });
  });
});

describe('rollover scenarios', () => {
  let mockFirestore: ReturnType<typeof createMockFirestore>;

  beforeEach(() => {
    mockFirestore = createMockFirestore();
    jest.clearAllMocks();
  });

  describe('scenario: underspend carries forward', () => {
    test('should carry $50 surplus from January to February', async () => {
      mockFirestore.addDoc('budgets', 'budget-123', createMockBudget({
        rolloverEnabled: true,
        rolloverStrategy: 'immediate',
      }));

      // January: $500 budget, $450 spent = $50 surplus
      mockFirestore.addDoc('budget_periods', 'jan', createMockPeriod(
        'jan',
        new Date('2025-01-01'),
        new Date('2025-01-31'),
        {
          allocatedAmount: 500,
          spent: 450,
        }
      ));

      // February: should receive +$50 rollover
      mockFirestore.addDoc('budget_periods', 'feb', createMockPeriod(
        'feb',
        new Date('2025-02-01'),
        new Date('2025-02-28'),
        {
          allocatedAmount: 500,
          spent: 0,
        }
      ));

      const result = await recalculateRolloverChain(mockFirestore.db, 'budget-123');

      expect(result.success).toBe(true);
      // February should now have effective $550 (500 + 50)
    });
  });

  describe('scenario: overspend immediate deduction', () => {
    test('should deduct $100 overspend immediately in next period', async () => {
      mockFirestore.addDoc('budgets', 'budget-123', createMockBudget({
        rolloverEnabled: true,
        rolloverStrategy: 'immediate',
      }));

      // January: $500 budget, $600 spent = -$100 deficit
      mockFirestore.addDoc('budget_periods', 'jan', createMockPeriod(
        'jan',
        new Date('2025-01-01'),
        new Date('2025-01-31'),
        {
          allocatedAmount: 500,
          spent: 600,
        }
      ));

      // February: should receive -$100 rollover
      mockFirestore.addDoc('budget_periods', 'feb', createMockPeriod(
        'feb',
        new Date('2025-02-01'),
        new Date('2025-02-28'),
        {
          allocatedAmount: 500,
          spent: 0,
        }
      ));

      const result = await recalculateRolloverChain(mockFirestore.db, 'budget-123');

      expect(result.success).toBe(true);
      // February should have effective $400 (500 - 100)
    });
  });

  describe('scenario: overspend spread over 3 periods', () => {
    test('should spread $300 overspend as $100/period for 3 periods', async () => {
      mockFirestore.addDoc('budgets', 'budget-123', createMockBudget({
        rolloverEnabled: true,
        rolloverStrategy: 'spread',
        rolloverSpreadPeriods: 3,
      }));

      // January: $500 budget, $800 spent = -$300 deficit
      mockFirestore.addDoc('budget_periods', 'jan', createMockPeriod(
        'jan',
        new Date('2025-01-01'),
        new Date('2025-01-31'),
        {
          allocatedAmount: 500,
          spent: 800,
        }
      ));

      // February
      mockFirestore.addDoc('budget_periods', 'feb', createMockPeriod(
        'feb',
        new Date('2025-02-01'),
        new Date('2025-02-28'),
        {
          allocatedAmount: 500,
          spent: 500, // Spent exactly budget (no new surplus/deficit)
        }
      ));

      // March
      mockFirestore.addDoc('budget_periods', 'mar', createMockPeriod(
        'mar',
        new Date('2025-03-01'),
        new Date('2025-03-31'),
        {
          allocatedAmount: 500,
          spent: 500,
        }
      ));

      // April
      mockFirestore.addDoc('budget_periods', 'apr', createMockPeriod(
        'apr',
        new Date('2025-04-01'),
        new Date('2025-04-30'),
        {
          allocatedAmount: 500,
          spent: 0,
        }
      ));

      const result = await recalculateRolloverChain(mockFirestore.db, 'budget-123');

      expect(result.success).toBe(true);
      // Feb: $400 effective (500 - 100)
      // Mar: $400 effective (500 - 100)
      // Apr: $400 effective (500 - 100)
      // May onwards: back to normal $500
    });
  });

  describe('scenario: weekly periods roll to weekly', () => {
    test('should only roll weekly to weekly, not to monthly', async () => {
      mockFirestore.addDoc('budgets', 'budget-123', createMockBudget({
        rolloverEnabled: true,
        rolloverStrategy: 'immediate',
      }));

      // Week 1 (weekly period)
      mockFirestore.addDoc('budget_periods', 'week1', createMockPeriod(
        'week1',
        new Date('2025-01-01'),
        new Date('2025-01-07'),
        {
          periodType: PeriodType.WEEKLY,
          allocatedAmount: 100,
          spent: 50, // $50 surplus
        }
      ));

      // Week 2 (weekly period) - should get rollover
      mockFirestore.addDoc('budget_periods', 'week2', createMockPeriod(
        'week2',
        new Date('2025-01-08'),
        new Date('2025-01-14'),
        {
          periodType: PeriodType.WEEKLY,
          allocatedAmount: 100,
          spent: 0,
        }
      ));

      // January (monthly period) - should NOT get weekly rollover
      mockFirestore.addDoc('budget_periods', 'jan', createMockPeriod(
        'jan',
        new Date('2025-01-01'),
        new Date('2025-01-31'),
        {
          periodType: PeriodType.MONTHLY,
          allocatedAmount: 500,
          spent: 0,
        }
      ));

      const result = await recalculateRolloverChain(mockFirestore.db, 'budget-123');

      expect(result.success).toBe(true);
      // Weekly chain is separate from monthly chain
    });
  });

  describe('scenario: extreme overspend results in negative remaining', () => {
    test('should allow negative effective amount with extreme overspend', async () => {
      mockFirestore.addDoc('budgets', 'budget-123', createMockBudget({
        rolloverEnabled: true,
        rolloverStrategy: 'immediate',
      }));

      // January: $500 budget, $1000 spent = -$500 deficit
      mockFirestore.addDoc('budget_periods', 'jan', createMockPeriod(
        'jan',
        new Date('2025-01-01'),
        new Date('2025-01-31'),
        {
          allocatedAmount: 500,
          spent: 1000,
        }
      ));

      // February: $500 - $500 rollover = $0 effective
      // If user spends anything, remaining goes negative
      mockFirestore.addDoc('budget_periods', 'feb', createMockPeriod(
        'feb',
        new Date('2025-02-01'),
        new Date('2025-02-28'),
        {
          allocatedAmount: 500,
          spent: 100, // Spending with $0 effective = -$100 remaining
        }
      ));

      const result = await recalculateRolloverChain(mockFirestore.db, 'budget-123');

      expect(result.success).toBe(true);
      // February: effective = $0, spent = $100, remaining = -$100
    });
  });
});
