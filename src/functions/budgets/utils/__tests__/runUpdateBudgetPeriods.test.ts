/**
 * Unit tests for runUpdateBudgetPeriods utility
 *
 * Tests the cascade of budget field changes to budget_periods.
 * Covers: name, amount, description, alertThreshold changes.
 * Verifies: current + future periods updated, historical preserved.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { runUpdateBudgetPeriods } from '../runUpdateBudgetPeriods';
import { Budget, BudgetPeriodDocument, PeriodType } from '../../../../types';

// Mock Firestore
const mockGet = jest.fn();
const mockBatch = jest.fn();
const mockCommit = jest.fn();
const mockUpdate = jest.fn();
const mockWhere = jest.fn();
const mockCollection = jest.fn();
const mockDoc = jest.fn();

const mockFirestore = {
  collection: mockCollection,
  batch: mockBatch
} as any;

// Helper to create mock budget
const createMockBudget = (overrides: Partial<Budget> = {}): Budget => ({
  id: 'budget-123',
  userId: 'user-123',
  groupIds: [],
  name: 'Test Budget',
  description: 'Test description',
  amount: 500,
  currency: 'USD',
  categoryIds: ['cat-1', 'cat-2'],
  period: 'monthly',
  alertThreshold: 80,
  isActive: true,
  isOngoing: true,
  budgetType: 'recurring',
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  ...overrides
} as Budget);

// Helper to create mock budget period
const createMockBudgetPeriod = (
  id: string,
  periodEnd: Date,
  overrides: Partial<BudgetPeriodDocument> = {}
): BudgetPeriodDocument => ({
  id,
  budgetId: 'budget-123',
  budgetName: 'Test Budget',
  periodId: '2025M04',
  sourcePeriodId: '2025M04',
  periodType: PeriodType.MONTHLY,
  periodStart: Timestamp.fromDate(new Date('2025-04-01')),
  periodEnd: Timestamp.fromDate(periodEnd),
  allocatedAmount: 500,
  originalAmount: 500,
  spent: 100,
  remaining: 400,
  isModified: false,
  checklistItems: [],
  lastCalculated: Timestamp.now(),
  isActive: true,
  userId: 'user-123',
  groupIds: [],
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  ...overrides
} as BudgetPeriodDocument);

describe('runUpdateBudgetPeriods', () => {
  const budgetId = 'budget-123';

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mock chain for collection queries
    mockCollection.mockImplementation((collectionName: string) => {
      if (collectionName === 'budget_periods') {
        return { where: mockWhere };
      }
      if (collectionName === 'source_periods') {
        return { doc: mockDoc };
      }
      return { where: mockWhere, doc: mockDoc };
    });

    mockWhere.mockReturnValue({ get: mockGet });

    // Setup batch mock
    mockBatch.mockReturnValue({
      update: mockUpdate,
      commit: mockCommit
    });
    mockCommit.mockResolvedValue(undefined);

    // Setup source period mock
    mockDoc.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        id: '2025M04',
        data: () => ({
          id: '2025M04',
          periodType: 'monthly',
          startDate: Timestamp.fromDate(new Date('2025-04-01')),
          endDate: Timestamp.fromDate(new Date('2025-04-30')),
          daysInPeriod: 30
        })
      })
    });
  });

  describe('No Changes Detection', () => {
    test('should return early when no relevant fields changed', async () => {
      const budgetBefore = createMockBudget();
      const budgetAfter = createMockBudget();

      const result = await runUpdateBudgetPeriods(
        mockFirestore,
        budgetId,
        budgetBefore,
        budgetAfter
      );

      expect(result.success).toBe(true);
      expect(result.fieldsUpdated).toEqual([]);
      expect(result.periodsQueried).toBe(0);
      expect(mockGet).not.toHaveBeenCalled();
    });
  });

  describe('Name Change Cascade', () => {
    test('should detect name change and update current + future periods', async () => {
      const budgetBefore = createMockBudget({ name: 'Old Name' });
      const budgetAfter = createMockBudget({ name: 'New Name' });

      // Mock future period (periodEnd >= today)
      const futurePeriodEnd = new Date();
      futurePeriodEnd.setMonth(futurePeriodEnd.getMonth() + 1);

      const mockPeriodDoc = {
        id: 'period-1',
        ref: { id: 'period-1' },
        data: () => createMockBudgetPeriod('period-1', futurePeriodEnd)
      };

      mockGet.mockResolvedValue({
        empty: false,
        size: 1,
        docs: [mockPeriodDoc]
      });

      const result = await runUpdateBudgetPeriods(
        mockFirestore,
        budgetId,
        budgetBefore,
        budgetAfter
      );

      expect(result.success).toBe(true);
      expect(result.fieldsUpdated).toContain('name');
      expect(result.periodsQueried).toBe(1);
      expect(result.periodsUpdated).toBe(1);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ budgetName: 'New Name' })
      );
    });

    test('should skip historical periods for name changes', async () => {
      const budgetBefore = createMockBudget({ name: 'Old Name' });
      const budgetAfter = createMockBudget({ name: 'New Name' });

      // Mock historical period (periodEnd < today)
      const historicalPeriodEnd = new Date();
      historicalPeriodEnd.setMonth(historicalPeriodEnd.getMonth() - 2);

      const mockHistoricalPeriod = {
        id: 'period-old',
        ref: { id: 'period-old' },
        data: () => createMockBudgetPeriod('period-old', historicalPeriodEnd)
      };

      mockGet.mockResolvedValue({
        empty: false,
        size: 1,
        docs: [mockHistoricalPeriod]
      });

      const result = await runUpdateBudgetPeriods(
        mockFirestore,
        budgetId,
        budgetBefore,
        budgetAfter
      );

      expect(result.success).toBe(true);
      expect(result.periodsQueried).toBe(1);
      expect(result.periodsSkipped).toBe(1);
      expect(result.periodsUpdated).toBe(0);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('Amount Change Cascade', () => {
    test('should recalculate allocatedAmount when budget amount changes', async () => {
      const budgetBefore = createMockBudget({ amount: 500 });
      const budgetAfter = createMockBudget({ amount: 750 });

      // Mock future period
      const futurePeriodEnd = new Date();
      futurePeriodEnd.setMonth(futurePeriodEnd.getMonth() + 1);

      const mockPeriodDoc = {
        id: 'period-1',
        ref: { id: 'period-1' },
        data: () => createMockBudgetPeriod('period-1', futurePeriodEnd, {
          spent: 100
        })
      };

      mockGet.mockResolvedValue({
        empty: false,
        size: 1,
        docs: [mockPeriodDoc]
      });

      const result = await runUpdateBudgetPeriods(
        mockFirestore,
        budgetId,
        budgetBefore,
        budgetAfter
      );

      expect(result.success).toBe(true);
      expect(result.fieldsUpdated).toContain('amount');
      expect(result.periodsUpdated).toBe(1);

      // Verify allocatedAmount was updated
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          allocatedAmount: expect.any(Number),
          originalAmount: expect.any(Number),
          remaining: expect.any(Number)
        })
      );
    });
  });

  describe('Multiple Field Changes', () => {
    test('should handle multiple field changes in one update', async () => {
      const budgetBefore = createMockBudget({
        name: 'Old Name',
        amount: 500,
        description: 'Old desc',
        alertThreshold: 80
      });
      const budgetAfter = createMockBudget({
        name: 'New Name',
        amount: 750,
        description: 'New desc',
        alertThreshold: 90
      });

      // Mock future period
      const futurePeriodEnd = new Date();
      futurePeriodEnd.setMonth(futurePeriodEnd.getMonth() + 1);

      const mockPeriodDoc = {
        id: 'period-1',
        ref: { id: 'period-1' },
        data: () => createMockBudgetPeriod('period-1', futurePeriodEnd)
      };

      mockGet.mockResolvedValue({
        empty: false,
        size: 1,
        docs: [mockPeriodDoc]
      });

      const result = await runUpdateBudgetPeriods(
        mockFirestore,
        budgetId,
        budgetBefore,
        budgetAfter
      );

      expect(result.success).toBe(true);
      expect(result.fieldsUpdated).toContain('name');
      expect(result.fieldsUpdated).toContain('amount');
      expect(result.fieldsUpdated).toContain('description');
      expect(result.fieldsUpdated).toContain('alertThreshold');
      expect(result.fieldsUpdated.length).toBe(4);
    });
  });

  describe('No Periods Found', () => {
    test('should handle budget with no periods gracefully', async () => {
      const budgetBefore = createMockBudget({ name: 'Old Name' });
      const budgetAfter = createMockBudget({ name: 'New Name' });

      mockGet.mockResolvedValue({
        empty: true,
        size: 0,
        docs: []
      });

      const result = await runUpdateBudgetPeriods(
        mockFirestore,
        budgetId,
        budgetBefore,
        budgetAfter
      );

      expect(result.success).toBe(true);
      expect(result.periodsQueried).toBe(0);
      expect(result.periodsUpdated).toBe(0);
    });
  });

  describe('Error Handling', () => {
    test('should capture errors without throwing', async () => {
      const budgetBefore = createMockBudget({ name: 'Old Name' });
      const budgetAfter = createMockBudget({ name: 'New Name' });

      mockGet.mockRejectedValue(new Error('Firestore error'));

      const result = await runUpdateBudgetPeriods(
        mockFirestore,
        budgetId,
        budgetBefore,
        budgetAfter
      );

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Firestore error');
    });
  });

  describe('Mixed Historical and Future Periods', () => {
    test('should update future periods and skip historical ones', async () => {
      const budgetBefore = createMockBudget({ name: 'Old Name' });
      const budgetAfter = createMockBudget({ name: 'New Name' });

      // Mock historical period
      const historicalPeriodEnd = new Date();
      historicalPeriodEnd.setMonth(historicalPeriodEnd.getMonth() - 2);

      // Mock future period
      const futurePeriodEnd = new Date();
      futurePeriodEnd.setMonth(futurePeriodEnd.getMonth() + 1);

      const mockHistoricalPeriod = {
        id: 'period-old',
        ref: { id: 'period-old' },
        data: () => createMockBudgetPeriod('period-old', historicalPeriodEnd)
      };

      const mockFuturePeriod = {
        id: 'period-future',
        ref: { id: 'period-future' },
        data: () => createMockBudgetPeriod('period-future', futurePeriodEnd)
      };

      mockGet.mockResolvedValue({
        empty: false,
        size: 2,
        docs: [mockHistoricalPeriod, mockFuturePeriod]
      });

      const result = await runUpdateBudgetPeriods(
        mockFirestore,
        budgetId,
        budgetBefore,
        budgetAfter
      );

      expect(result.success).toBe(true);
      expect(result.periodsQueried).toBe(2);
      expect(result.periodsUpdated).toBe(1);
      expect(result.periodsSkipped).toBe(1);
    });
  });
});
