/**
 * Tests for syncNotesToOverlappingPeriods utility
 *
 * Tests the syncing of notes, checklist items, and modified amounts
 * across overlapping periods of different types.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { BudgetPeriodDocument, PeriodType } from '../../../../types';

// Mock firebase-admin
jest.mock('firebase-admin', () => ({
  firestore: jest.fn(() => ({
    collection: jest.fn(),
    batch: jest.fn()
  })),
  initializeApp: jest.fn()
}));

// Import after mocking
import {
  syncNotesToOverlappingPeriods,
  syncChecklistToOverlappingPeriods,
  syncModifiedAmountToOverlappingPeriods
} from '../syncNotesToOverlappingPeriods';

describe('syncNotesToOverlappingPeriods', () => {
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

  const createMockPeriod = (overrides: Partial<BudgetPeriodDocument> = {}): BudgetPeriodDocument => ({
    id: 'period-1',
    budgetId: 'budget-123',
    budgetName: 'Test Budget',
    periodId: 'source-1',
    sourcePeriodId: 'source-1',
    periodType: PeriodType.MONTHLY,
    periodStart: Timestamp.fromDate(new Date('2025-04-01')),
    periodEnd: Timestamp.fromDate(new Date('2025-04-30')),
    allocatedAmount: 500,
    originalAmount: 500,
    isModified: false,
    checklistItems: [],
    lastCalculated: Timestamp.now(),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    userId: 'user-123',
    groupIds: [],
    isActive: true,
    ...overrides
  });

  describe('syncNotesToOverlappingPeriods', () => {
    it('should sync notes to overlapping periods of other types', async () => {
      const sourcePeriod = createMockPeriod({
        periodType: PeriodType.MONTHLY,
        userNotes: 'New note'
      });

      // Mock overlapping weekly periods
      const mockWeeklyPeriod = {
        id: 'weekly-period-1',
        ref: { id: 'weekly-period-1' },
        data: () => ({
          budgetId: 'budget-123',
          periodType: PeriodType.WEEKLY,
          periodStart: Timestamp.fromDate(new Date('2025-04-07')),
          periodEnd: Timestamp.fromDate(new Date('2025-04-13')),
          userNotes: 'Old note'
        })
      };

      mockDb.collection().get.mockResolvedValue({
        empty: false,
        size: 1,
        docs: [mockWeeklyPeriod]
      });

      const result = await syncNotesToOverlappingPeriods(
        mockDb,
        sourcePeriod,
        'New note'
      );

      expect(result.success).toBe(true);
      expect(result.periodsQueried).toBe(1);
      expect(result.periodsUpdated).toBe(1);
      expect(mockBatch.update).toHaveBeenCalledWith(
        mockWeeklyPeriod.ref,
        expect.objectContaining({
          userNotes: 'New note',
          notesSyncedFrom: 'period-1'
        })
      );
      expect(mockBatch.commit).toHaveBeenCalled();
    });

    it('should skip periods that already have the same notes', async () => {
      const sourcePeriod = createMockPeriod({
        userNotes: 'Same note'
      });

      const mockPeriod = {
        id: 'period-2',
        ref: { id: 'period-2' },
        data: () => ({
          budgetId: 'budget-123',
          periodType: PeriodType.WEEKLY,
          periodStart: Timestamp.fromDate(new Date('2025-04-07')),
          periodEnd: Timestamp.fromDate(new Date('2025-04-13')),
          userNotes: 'Same note' // Same notes
        })
      };

      mockDb.collection().get.mockResolvedValue({
        empty: false,
        size: 1,
        docs: [mockPeriod]
      });

      const result = await syncNotesToOverlappingPeriods(
        mockDb,
        sourcePeriod,
        'Same note'
      );

      expect(result.success).toBe(true);
      expect(result.periodsUpdated).toBe(0);
      expect(mockBatch.update).not.toHaveBeenCalled();
    });

    it('should not sync to non-overlapping periods', async () => {
      const sourcePeriod = createMockPeriod({
        periodStart: Timestamp.fromDate(new Date('2025-04-01')),
        periodEnd: Timestamp.fromDate(new Date('2025-04-30'))
      });

      // Non-overlapping period (May)
      const mockPeriod = {
        id: 'period-2',
        ref: { id: 'period-2' },
        data: () => ({
          budgetId: 'budget-123',
          periodType: PeriodType.WEEKLY,
          periodStart: Timestamp.fromDate(new Date('2025-05-05')),
          periodEnd: Timestamp.fromDate(new Date('2025-05-11'))
        })
      };

      mockDb.collection().get.mockResolvedValue({
        empty: false,
        size: 1,
        docs: [mockPeriod]
      });

      const result = await syncNotesToOverlappingPeriods(
        mockDb,
        sourcePeriod,
        'New note'
      );

      expect(result.success).toBe(true);
      expect(result.periodsUpdated).toBe(0);
    });

    it('should return success with no updates when no other periods exist', async () => {
      const sourcePeriod = createMockPeriod();

      mockDb.collection().get.mockResolvedValue({
        empty: true,
        size: 0,
        docs: []
      });

      const result = await syncNotesToOverlappingPeriods(
        mockDb,
        sourcePeriod,
        'New note'
      );

      expect(result.success).toBe(true);
      expect(result.periodsQueried).toBe(0);
      expect(result.periodsUpdated).toBe(0);
    });
  });

  describe('syncChecklistToOverlappingPeriods', () => {
    it('should sync checklist items to overlapping periods', async () => {
      const sourcePeriod = createMockPeriod();
      const newChecklistItems = [
        { id: '1', text: 'Item 1', completed: false },
        { id: '2', text: 'Item 2', completed: true }
      ];

      const mockPeriod = {
        id: 'period-2',
        ref: { id: 'period-2' },
        data: () => ({
          budgetId: 'budget-123',
          periodType: PeriodType.WEEKLY,
          periodStart: Timestamp.fromDate(new Date('2025-04-07')),
          periodEnd: Timestamp.fromDate(new Date('2025-04-13')),
          checklistItems: []
        })
      };

      mockDb.collection().get.mockResolvedValue({
        empty: false,
        size: 1,
        docs: [mockPeriod]
      });

      const result = await syncChecklistToOverlappingPeriods(
        mockDb,
        sourcePeriod,
        newChecklistItems
      );

      expect(result.success).toBe(true);
      expect(result.periodsUpdated).toBe(1);
      expect(mockBatch.update).toHaveBeenCalledWith(
        mockPeriod.ref,
        expect.objectContaining({
          checklistItems: newChecklistItems,
          checklistSyncedFrom: 'period-1'
        })
      );
    });
  });

  describe('syncModifiedAmountToOverlappingPeriods', () => {
    it('should sync modified amount to overlapping periods', async () => {
      const sourcePeriod = createMockPeriod();

      const mockPeriod = {
        id: 'period-2',
        ref: { id: 'period-2' },
        data: () => ({
          budgetId: 'budget-123',
          periodType: PeriodType.WEEKLY,
          periodStart: Timestamp.fromDate(new Date('2025-04-07')),
          periodEnd: Timestamp.fromDate(new Date('2025-04-13')),
          modifiedAmount: undefined,
          isModified: false
        })
      };

      mockDb.collection().get.mockResolvedValue({
        empty: false,
        size: 1,
        docs: [mockPeriod]
      });

      const result = await syncModifiedAmountToOverlappingPeriods(
        mockDb,
        sourcePeriod,
        750
      );

      expect(result.success).toBe(true);
      expect(result.periodsUpdated).toBe(1);
      expect(mockBatch.update).toHaveBeenCalledWith(
        mockPeriod.ref,
        expect.objectContaining({
          modifiedAmount: 750,
          isModified: true,
          modifiedAmountSyncedFrom: 'period-1'
        })
      );
    });

    it('should clear modified amount when undefined', async () => {
      const sourcePeriod = createMockPeriod();

      const mockPeriod = {
        id: 'period-2',
        ref: { id: 'period-2' },
        data: () => ({
          budgetId: 'budget-123',
          periodType: PeriodType.WEEKLY,
          periodStart: Timestamp.fromDate(new Date('2025-04-07')),
          periodEnd: Timestamp.fromDate(new Date('2025-04-13')),
          modifiedAmount: 750,
          isModified: true
        })
      };

      mockDb.collection().get.mockResolvedValue({
        empty: false,
        size: 1,
        docs: [mockPeriod]
      });

      const result = await syncModifiedAmountToOverlappingPeriods(
        mockDb,
        sourcePeriod,
        undefined
      );

      expect(result.success).toBe(true);
      expect(result.periodsUpdated).toBe(1);
      expect(mockBatch.update).toHaveBeenCalledWith(
        mockPeriod.ref,
        expect.objectContaining({
          isModified: false
        })
      );
    });
  });

  describe('error handling', () => {
    it('should handle Firestore errors gracefully', async () => {
      const sourcePeriod = createMockPeriod();

      mockDb.collection().get.mockRejectedValue(new Error('Firestore error'));

      const result = await syncNotesToOverlappingPeriods(
        mockDb,
        sourcePeriod,
        'New note'
      );

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Firestore error');
    });
  });
});
