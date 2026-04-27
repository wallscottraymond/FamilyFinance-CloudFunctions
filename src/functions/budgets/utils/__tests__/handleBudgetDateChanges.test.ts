/**
 * Tests for handleBudgetDateChanges utility
 *
 * Tests period management when budget date-related fields change:
 * - startDate changes
 * - isOngoing changes
 * - budgetEndDate changes
 */

import { Timestamp } from 'firebase-admin/firestore';
import { Budget, PeriodType } from '../../../../types';

// Mock firebase-admin
jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      delete: jest.fn(() => ({ _methodName: 'delete' }))
    }
  },
  initializeApp: jest.fn()
}));

// Import after mocking
import { handleBudgetDateChanges } from '../handleBudgetDateChanges';

describe('handleBudgetDateChanges', () => {
  let mockDb: any;
  let mockBatch: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockBatch = {
      update: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined)
    };

    mockDb = {
      collection: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        get: jest.fn()
      }),
      batch: jest.fn().mockReturnValue(mockBatch)
    };
  });

  const createMockBudget = (overrides: Partial<Budget> = {}): Budget => ({
    id: 'budget-123',
    name: 'Test Budget',
    amount: 500,
    budgetType: 'recurring',
    startDate: Timestamp.fromDate(new Date('2025-01-01')),
    isOngoing: true,
    categoryIds: ['cat-1'],
    userId: 'user-123',
    groupIds: [],
    isActive: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides
  });

  describe('no changes detection', () => {
    it('should return early if no date-related changes', async () => {
      const before = createMockBudget();
      const after = createMockBudget({ name: 'Updated Name' }); // Only name changed

      const result = await handleBudgetDateChanges(
        mockDb,
        'budget-123',
        before,
        after
      );

      expect(result.success).toBe(true);
      expect(result.startDateChange.detected).toBe(false);
      expect(result.endDateChange.detected).toBe(false);
      expect(mockDb.collection).not.toHaveBeenCalled();
    });
  });

  describe('startDate changes', () => {
    it('should detect startDate moving later', async () => {
      const before = createMockBudget({
        startDate: Timestamp.fromDate(new Date('2025-01-01'))
      });
      const after = createMockBudget({
        startDate: Timestamp.fromDate(new Date('2025-03-01'))
      });

      // Mock periods before new start date
      const mockEarlyPeriod = {
        id: 'period-jan',
        ref: { id: 'period-jan' },
        data: () => ({
          budgetId: 'budget-123',
          periodType: PeriodType.MONTHLY,
          periodStart: Timestamp.fromDate(new Date('2025-01-01')),
          periodEnd: Timestamp.fromDate(new Date('2025-01-31')),
          isActive: true
        })
      };

      mockDb.collection().get.mockResolvedValue({
        empty: false,
        size: 1,
        docs: [mockEarlyPeriod]
      });

      const result = await handleBudgetDateChanges(
        mockDb,
        'budget-123',
        before,
        after
      );

      expect(result.success).toBe(true);
      expect(result.startDateChange.detected).toBe(true);
      expect(result.startDateChange.periodsDeactivated).toBe(1);
      expect(mockBatch.update).toHaveBeenCalledWith(
        mockEarlyPeriod.ref,
        expect.objectContaining({
          isActive: false,
          deactivationReason: 'startDate_moved_later'
        })
      );
    });

    it('should detect startDate moving earlier', async () => {
      const before = createMockBudget({
        startDate: Timestamp.fromDate(new Date('2025-03-01'))
      });
      const after = createMockBudget({
        startDate: Timestamp.fromDate(new Date('2025-01-01'))
      });

      // Mock existing periods starting from March
      const mockMarchPeriod = {
        id: 'period-mar',
        ref: { id: 'period-mar' },
        data: () => ({
          budgetId: 'budget-123',
          periodType: PeriodType.MONTHLY,
          periodStart: Timestamp.fromDate(new Date('2025-03-01')),
          periodEnd: Timestamp.fromDate(new Date('2025-03-31'))
        })
      };

      mockDb.collection().get.mockResolvedValue({
        empty: false,
        size: 1,
        docs: [mockMarchPeriod]
      });

      const result = await handleBudgetDateChanges(
        mockDb,
        'budget-123',
        before,
        after
      );

      expect(result.success).toBe(true);
      expect(result.startDateChange.detected).toBe(true);
      // Note: Period generation for gap is logged but not yet implemented
    });
  });

  describe('isOngoing changes', () => {
    it('should detect changing from ongoing to limited', async () => {
      const before = createMockBudget({
        isOngoing: true,
        budgetEndDate: undefined
      });
      const after = createMockBudget({
        isOngoing: false,
        budgetEndDate: Timestamp.fromDate(new Date('2025-06-30'))
      });

      // Mock period after end date
      const mockFuturePeriod = {
        id: 'period-jul',
        ref: { id: 'period-jul' },
        data: () => ({
          budgetId: 'budget-123',
          periodType: PeriodType.MONTHLY,
          periodStart: Timestamp.fromDate(new Date('2025-07-01')),
          periodEnd: Timestamp.fromDate(new Date('2025-07-31')),
          isActive: true
        })
      };

      mockDb.collection().get.mockResolvedValue({
        empty: false,
        size: 1,
        docs: [mockFuturePeriod]
      });

      const result = await handleBudgetDateChanges(
        mockDb,
        'budget-123',
        before,
        after
      );

      expect(result.success).toBe(true);
      expect(result.endDateChange.detected).toBe(true);
      expect(result.endDateChange.periodsDeactivated).toBe(1);
      expect(mockBatch.update).toHaveBeenCalledWith(
        mockFuturePeriod.ref,
        expect.objectContaining({
          isActive: false,
          deactivationReason: 'budget_end_date_reached'
        })
      );
    });

    it('should detect changing from limited to ongoing', async () => {
      const before = createMockBudget({
        isOngoing: false,
        budgetEndDate: Timestamp.fromDate(new Date('2025-06-30'))
      });
      const after = createMockBudget({
        isOngoing: true,
        budgetEndDate: undefined
      });

      // Mock deactivated period that should be reactivated
      const mockDeactivatedPeriod = {
        id: 'period-jul',
        ref: { id: 'period-jul' },
        data: () => ({
          budgetId: 'budget-123',
          periodType: PeriodType.MONTHLY,
          periodStart: Timestamp.fromDate(new Date('2025-07-01')),
          periodEnd: Timestamp.fromDate(new Date('2025-07-31')),
          isActive: false,
          deactivationReason: 'budget_end_date_reached'
        })
      };

      mockDb.collection().get.mockResolvedValue({
        empty: false,
        size: 1,
        docs: [mockDeactivatedPeriod]
      });

      const result = await handleBudgetDateChanges(
        mockDb,
        'budget-123',
        before,
        after
      );

      expect(result.success).toBe(true);
      expect(result.endDateChange.detected).toBe(true);
      expect(result.endDateChange.periodsReactivated).toBe(1);
      expect(mockBatch.update).toHaveBeenCalledWith(
        mockDeactivatedPeriod.ref,
        expect.objectContaining({
          isActive: true
        })
      );
    });
  });

  describe('budgetEndDate changes', () => {
    it('should handle end date moving earlier', async () => {
      const before = createMockBudget({
        isOngoing: false,
        budgetEndDate: Timestamp.fromDate(new Date('2025-12-31'))
      });
      const after = createMockBudget({
        isOngoing: false,
        budgetEndDate: Timestamp.fromDate(new Date('2025-06-30'))
      });

      // Mock period that should be deactivated
      const mockPeriod = {
        id: 'period-jul',
        ref: { id: 'period-jul' },
        data: () => ({
          budgetId: 'budget-123',
          periodType: PeriodType.MONTHLY,
          periodStart: Timestamp.fromDate(new Date('2025-07-01')),
          periodEnd: Timestamp.fromDate(new Date('2025-07-31')),
          isActive: true
        })
      };

      mockDb.collection().get.mockResolvedValue({
        empty: false,
        size: 1,
        docs: [mockPeriod]
      });

      const result = await handleBudgetDateChanges(
        mockDb,
        'budget-123',
        before,
        after
      );

      expect(result.success).toBe(true);
      expect(result.endDateChange.detected).toBe(true);
      expect(result.endDateChange.periodsDeactivated).toBe(1);
    });

    it('should handle end date moving later', async () => {
      const before = createMockBudget({
        isOngoing: false,
        budgetEndDate: Timestamp.fromDate(new Date('2025-06-30'))
      });
      const after = createMockBudget({
        isOngoing: false,
        budgetEndDate: Timestamp.fromDate(new Date('2025-12-31'))
      });

      // Mock period that was deactivated due to end date
      const mockPeriod = {
        id: 'period-jul',
        ref: { id: 'period-jul' },
        data: () => ({
          budgetId: 'budget-123',
          periodType: PeriodType.MONTHLY,
          periodStart: Timestamp.fromDate(new Date('2025-07-01')),
          periodEnd: Timestamp.fromDate(new Date('2025-07-31')),
          isActive: false,
          deactivationReason: 'budget_end_date_reached'
        })
      };

      mockDb.collection().get.mockResolvedValue({
        empty: false,
        size: 1,
        docs: [mockPeriod]
      });

      const result = await handleBudgetDateChanges(
        mockDb,
        'budget-123',
        before,
        after
      );

      expect(result.success).toBe(true);
      expect(result.endDateChange.detected).toBe(true);
      expect(result.endDateChange.periodsReactivated).toBe(1);
    });
  });

  describe('error handling', () => {
    it('should handle Firestore errors gracefully', async () => {
      const before = createMockBudget({
        startDate: Timestamp.fromDate(new Date('2025-01-01'))
      });
      const after = createMockBudget({
        startDate: Timestamp.fromDate(new Date('2025-03-01'))
      });

      mockDb.collection().get.mockRejectedValue(new Error('Firestore error'));

      const result = await handleBudgetDateChanges(
        mockDb,
        'budget-123',
        before,
        after
      );

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Firestore error');
    });
  });

  describe('edge cases', () => {
    it('should handle empty period list', async () => {
      const before = createMockBudget({
        startDate: Timestamp.fromDate(new Date('2025-01-01'))
      });
      const after = createMockBudget({
        startDate: Timestamp.fromDate(new Date('2025-03-01'))
      });

      mockDb.collection().get.mockResolvedValue({
        empty: true,
        size: 0,
        docs: []
      });

      const result = await handleBudgetDateChanges(
        mockDb,
        'budget-123',
        before,
        after
      );

      expect(result.success).toBe(true);
      expect(result.startDateChange.periodsDeactivated).toBe(0);
    });

    it('should not deactivate already inactive periods', async () => {
      const before = createMockBudget({
        isOngoing: true
      });
      const after = createMockBudget({
        isOngoing: false,
        budgetEndDate: Timestamp.fromDate(new Date('2025-06-30'))
      });

      // Period already inactive (not due to budget end date)
      const mockPeriod = {
        id: 'period-jul',
        ref: { id: 'period-jul' },
        data: () => ({
          budgetId: 'budget-123',
          periodType: PeriodType.MONTHLY,
          periodStart: Timestamp.fromDate(new Date('2025-07-01')),
          periodEnd: Timestamp.fromDate(new Date('2025-07-31')),
          isActive: false,
          deactivationReason: 'user_paused'
        })
      };

      mockDb.collection().get.mockResolvedValue({
        empty: false,
        size: 1,
        docs: [mockPeriod]
      });

      const result = await handleBudgetDateChanges(
        mockDb,
        'budget-123',
        before,
        after
      );

      expect(result.success).toBe(true);
      expect(result.endDateChange.periodsDeactivated).toBe(0);
    });
  });
});
