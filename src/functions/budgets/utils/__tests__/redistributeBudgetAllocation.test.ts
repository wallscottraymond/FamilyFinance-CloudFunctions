/**
 * Unit tests for redistributeBudgetAllocation utility
 *
 * Tests the pause/resume functionality for budgets:
 * - Pausing: allocatedAmount redistributes to Everything Else
 * - Resuming: allocation reclaimed from Everything Else
 */

import { Timestamp } from 'firebase-admin/firestore';
import { redistributeBudgetAllocation } from '../redistributeBudgetAllocation';

// Mock Firestore
const mockGet = jest.fn();
const mockRunTransaction = jest.fn();
const mockWhere = jest.fn();
const mockLimit = jest.fn();
const mockCollection = jest.fn();
const mockUpdate = jest.fn();

const mockFirestore = {
  collection: mockCollection,
  runTransaction: mockRunTransaction
} as any;

describe('redistributeBudgetAllocation', () => {
  const budgetId = 'budget-123';
  const userId = 'user-123';
  const everythingElseBudgetId = 'everything-else-budget';
  const sourcePeriodId = '2025M04';

  // Helper to create mock period
  const createMockPeriod = (id: string, overrides: any = {}) => ({
    id,
    budgetId: overrides.budgetId || budgetId,
    sourcePeriodId,
    allocatedAmount: overrides.allocatedAmount ?? 500,
    originalAmount: overrides.originalAmount ?? 500,
    spent: overrides.spent ?? 100,
    remaining: overrides.remaining ?? 400,
    isActive: overrides.isActive ?? true,
    pausedAllocatedAmount: overrides.pausedAllocatedAmount,
    periodStart: Timestamp.fromDate(new Date('2025-04-01')),
    periodEnd: Timestamp.fromDate(new Date('2025-04-30')),
    periodType: 'monthly'
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock setup
    mockCollection.mockImplementation((collectionName: string) => {
      return {
        where: mockWhere,
        doc: jest.fn().mockReturnValue({
          get: mockGet
        })
      };
    });

    mockWhere.mockReturnValue({
      where: mockWhere,
      limit: mockLimit,
      get: mockGet
    });

    mockLimit.mockReturnValue({
      get: mockGet
    });
  });

  describe('Pause Budget (isActive false)', () => {
    test('should redistribute allocation to Everything Else when pausing', async () => {
      // Mock Everything Else budget found
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{
          id: everythingElseBudgetId,
          data: () => ({ isSystemEverythingElse: true })
        }]
      });

      // Mock current budget period found
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{
          id: 'budget-period-123',
          ref: { id: 'budget-period-123' },
          data: () => createMockPeriod('budget-period-123', {
            allocatedAmount: 500,
            spent: 100
          })
        }]
      });

      // Mock Everything Else period found
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{
          id: 'everything-else-period',
          ref: { id: 'everything-else-period' },
          data: () => createMockPeriod('everything-else-period', {
            budgetId: everythingElseBudgetId,
            allocatedAmount: 200,
            spent: 50
          })
        }]
      });

      // Mock transaction
      mockRunTransaction.mockImplementation(async (callback: Function) => {
        const mockTransaction = {
          update: mockUpdate
        };
        await callback(mockTransaction);
      });

      const result = await redistributeBudgetAllocation(
        mockFirestore,
        budgetId,
        userId,
        true // isPausing
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('paused');
      expect(result.amountRedistributed).toBe(500);
      expect(result.budgetPeriodId).toBe('budget-period-123');
      expect(result.everythingElsePeriodId).toBe('everything-else-period');
    });

    test('should set period inactive and store pausedAllocatedAmount', async () => {
      // Mock Everything Else budget
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{
          id: everythingElseBudgetId,
          data: () => ({ isSystemEverythingElse: true })
        }]
      });

      // Mock budget period
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{
          id: 'budget-period-123',
          ref: { id: 'budget-period-123', path: 'budget_periods/budget-period-123' },
          data: () => createMockPeriod('budget-period-123', {
            allocatedAmount: 500,
            spent: 100
          })
        }]
      });

      // Mock Everything Else period
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{
          id: 'ee-period',
          ref: { id: 'ee-period', path: 'budget_periods/ee-period' },
          data: () => createMockPeriod('ee-period', {
            budgetId: everythingElseBudgetId,
            allocatedAmount: 200
          })
        }]
      });

      let capturedBudgetPeriodUpdate: any;
      let capturedEEPeriodUpdate: any;

      mockRunTransaction.mockImplementation(async (callback: Function) => {
        const mockTransaction = {
          update: jest.fn((ref: any, data: any) => {
            if (ref.path?.includes('budget-period-123')) {
              capturedBudgetPeriodUpdate = data;
            } else {
              capturedEEPeriodUpdate = data;
            }
          })
        };
        await callback(mockTransaction);
      });

      await redistributeBudgetAllocation(
        mockFirestore,
        budgetId,
        userId,
        true // isPausing
      );

      // Verify budget period updates
      expect(capturedBudgetPeriodUpdate.isActive).toBe(false);
      expect(capturedBudgetPeriodUpdate.pausedAllocatedAmount).toBe(500);
      expect(capturedBudgetPeriodUpdate.allocatedAmount).toBe(0);

      // Verify Everything Else period receives the allocation
      expect(capturedEEPeriodUpdate.allocatedAmount).toBe(700); // 200 + 500
    });
  });

  describe('Resume Budget (isActive true)', () => {
    test('should reclaim allocation from Everything Else when resuming', async () => {
      // Mock Everything Else budget
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{
          id: everythingElseBudgetId,
          data: () => ({ isSystemEverythingElse: true })
        }]
      });

      // Mock budget period (was paused)
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{
          id: 'budget-period-123',
          ref: { id: 'budget-period-123' },
          data: () => createMockPeriod('budget-period-123', {
            allocatedAmount: 0,
            pausedAllocatedAmount: 500,
            originalAmount: 500,
            isActive: false,
            spent: 100
          })
        }]
      });

      // Mock Everything Else period
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{
          id: 'ee-period',
          ref: { id: 'ee-period' },
          data: () => createMockPeriod('ee-period', {
            budgetId: everythingElseBudgetId,
            allocatedAmount: 700 // Includes redistributed 500
          })
        }]
      });

      mockRunTransaction.mockImplementation(async (callback: Function) => {
        const mockTransaction = { update: mockUpdate };
        await callback(mockTransaction);
      });

      const result = await redistributeBudgetAllocation(
        mockFirestore,
        budgetId,
        userId,
        false // isResuming
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('resumed');
      expect(result.amountRedistributed).toBe(500);
    });
  });

  describe('Edge Cases', () => {
    test('should handle Everything Else budget not found', async () => {
      mockGet.mockResolvedValueOnce({
        empty: true,
        docs: []
      });

      const result = await redistributeBudgetAllocation(
        mockFirestore,
        budgetId,
        userId,
        true
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Everything Else budget not found');
    });

    test('should handle no current period found', async () => {
      // Mock Everything Else budget found
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{
          id: everythingElseBudgetId,
          data: () => ({ isSystemEverythingElse: true })
        }]
      });

      // Mock no current period found
      mockGet.mockResolvedValueOnce({
        empty: true,
        docs: []
      });

      const result = await redistributeBudgetAllocation(
        mockFirestore,
        budgetId,
        userId,
        true
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No current period found');
    });

    test('should handle zero allocation gracefully', async () => {
      // Mock Everything Else budget
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{
          id: everythingElseBudgetId,
          data: () => ({ isSystemEverythingElse: true })
        }]
      });

      // Mock budget period with zero allocation
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{
          id: 'budget-period-123',
          ref: { id: 'budget-period-123' },
          data: () => createMockPeriod('budget-period-123', {
            allocatedAmount: 0
          })
        }]
      });

      // Mock Everything Else period
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{
          id: 'ee-period',
          ref: { id: 'ee-period' },
          data: () => createMockPeriod('ee-period', {
            budgetId: everythingElseBudgetId
          })
        }]
      });

      const result = await redistributeBudgetAllocation(
        mockFirestore,
        budgetId,
        userId,
        true
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('none');
      expect(result.amountRedistributed).toBe(0);
    });
  });

  describe('Error Handling', () => {
    test('should capture transaction errors', async () => {
      // Mock Everything Else budget
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{
          id: everythingElseBudgetId,
          data: () => ({ isSystemEverythingElse: true })
        }]
      });

      // Mock budget period
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{
          id: 'budget-period-123',
          ref: { id: 'budget-period-123' },
          data: () => createMockPeriod('budget-period-123')
        }]
      });

      // Mock Everything Else period
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{
          id: 'ee-period',
          ref: { id: 'ee-period' },
          data: () => createMockPeriod('ee-period', {
            budgetId: everythingElseBudgetId
          })
        }]
      });

      mockRunTransaction.mockRejectedValue(new Error('Transaction failed'));

      const result = await redistributeBudgetAllocation(
        mockFirestore,
        budgetId,
        userId,
        true
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Transaction failed');
    });
  });
});
