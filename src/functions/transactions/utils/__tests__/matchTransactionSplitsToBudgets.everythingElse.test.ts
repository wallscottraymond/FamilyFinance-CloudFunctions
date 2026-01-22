/**
 * Test suite for transaction matching with "Everything Else" budget fallback
 *
 * Tests that transaction splits are correctly matched to budgets with the
 * "everything else" system budget acting as a catch-all for unmatched transactions.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { matchTransactionSplitsToBudgets } from '../matchTransactionSplitsToBudgets';
import { Transaction as FamilyTransaction } from '../../../../types';

// Mock database - declare before using in jest.mock
const mockGet = jest.fn();
const mockWhere = jest.fn();
const mockCollection = jest.fn(() => ({
  where: mockWhere
}));

jest.mock('../../../../index', () => ({
  db: {
    collection: jest.fn()
  }
}));

// Import the mocked db after the mock is set up
import { db } from '../../../../index';
(db.collection as jest.Mock) = mockCollection;

describe('matchTransactionSplitsToBudgets - Everything Else Budget', () => {
  const userId = 'test-user-123';
  const now = Timestamp.now();
  const oneMonthAgo = Timestamp.fromMillis(now.toMillis() - 30 * 24 * 60 * 60 * 1000);
  const twoMonthsAgo = Timestamp.fromMillis(now.toMillis() - 60 * 24 * 60 * 60 * 1000);

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mock chain
    mockCollection.mockReturnValue({
      where: mockWhere
    });
    mockWhere.mockReturnValue({
      where: mockWhere,
      get: mockGet
    });
  });

  const createMockTransaction = (date: Timestamp, id: string = 'txn-1'): FamilyTransaction => ({
    id,
    userId,
    transactionDate: date,
    amount: 100,
    description: 'Test transaction',
    splits: [{
      amount: 100,
      budgetId: 'unassigned',
      categoryId: 'food',
      updatedAt: now
    }],
    createdAt: now,
    updatedAt: now
  } as any);

  describe('Priority Matching - Regular Budgets First', () => {
    test('should match regular budget when transaction date is within range', async () => {
      // Mock budgets: 1 regular budget + 1 everything else budget
      mockGet.mockResolvedValueOnce({
        size: 2,
        docs: [
          {
            id: 'budget-groceries',
            data: () => ({
              name: 'Groceries',
              startDate: twoMonthsAgo,
              endDate: now,
              isOngoing: false,
              isSystemEverythingElse: false
            })
          },
          {
            id: 'budget-everything-else',
            data: () => ({
              name: 'Everything Else',
              startDate: twoMonthsAgo,
              isOngoing: true,
              isSystemEverythingElse: true
            })
          }
        ]
      });

      const transactions = [createMockTransaction(oneMonthAgo)];
      const result = await matchTransactionSplitsToBudgets(transactions, userId);

      // Should match the regular budget, NOT the everything else budget
      expect(result[0].splits[0].budgetId).toBe('budget-groceries');
    });

    test('should match first regular budget when multiple budgets match', async () => {
      // Mock multiple regular budgets + everything else
      mockGet.mockResolvedValueOnce({
        size: 3,
        docs: [
          {
            id: 'budget-first',
            data: () => ({
              name: 'First Budget',
              startDate: twoMonthsAgo,
              isOngoing: true,
              isSystemEverythingElse: false
            })
          },
          {
            id: 'budget-second',
            data: () => ({
              name: 'Second Budget',
              startDate: twoMonthsAgo,
              isOngoing: true,
              isSystemEverythingElse: false
            })
          },
          {
            id: 'budget-everything-else',
            data: () => ({
              name: 'Everything Else',
              startDate: twoMonthsAgo,
              isOngoing: true,
              isSystemEverythingElse: true
            })
          }
        ]
      });

      const transactions = [createMockTransaction(oneMonthAgo)];
      const result = await matchTransactionSplitsToBudgets(transactions, userId);

      // Should match first regular budget
      expect(result[0].splits[0].budgetId).toBe('budget-first');
    });
  });

  describe('Fallback to Everything Else Budget', () => {
    test('should fallback to everything else when no regular budget matches', async () => {
      // Mock budgets: 1 regular budget with non-matching date range + everything else
      mockGet.mockResolvedValueOnce({
        size: 2,
        docs: [
          {
            id: 'budget-groceries',
            data: () => ({
              name: 'Groceries',
              startDate: Timestamp.fromMillis(now.toMillis() + 24 * 60 * 60 * 1000), // Future date
              isOngoing: false,
              isSystemEverythingElse: false
            })
          },
          {
            id: 'budget-everything-else',
            data: () => ({
              name: 'Everything Else',
              startDate: twoMonthsAgo,
              isOngoing: true,
              isSystemEverythingElse: true
            })
          }
        ]
      });

      const transactions = [createMockTransaction(oneMonthAgo)];
      const result = await matchTransactionSplitsToBudgets(transactions, userId);

      // Should fallback to everything else budget
      expect(result[0].splits[0].budgetId).toBe('budget-everything-else');
    });

    test('should fallback to everything else when regular budget date range does not match', async () => {
      // Mock budgets: Regular budget with past end date + everything else
      const threeMonthsAgo = Timestamp.fromMillis(now.toMillis() - 90 * 24 * 60 * 60 * 1000);

      mockGet.mockResolvedValueOnce({
        size: 2,
        docs: [
          {
            id: 'budget-expired',
            data: () => ({
              name: 'Expired Budget',
              startDate: threeMonthsAgo,
              endDate: twoMonthsAgo, // Ended 2 months ago
              isOngoing: false,
              isSystemEverythingElse: false
            })
          },
          {
            id: 'budget-everything-else',
            data: () => ({
              name: 'Everything Else',
              startDate: threeMonthsAgo,
              isOngoing: true,
              isSystemEverythingElse: true
            })
          }
        ]
      });

      const transactions = [createMockTransaction(oneMonthAgo)]; // Transaction after budget ended
      const result = await matchTransactionSplitsToBudgets(transactions, userId);

      expect(result[0].splits[0].budgetId).toBe('budget-everything-else');
    });

    test('should fallback to everything else when only everything else budget exists', async () => {
      // Mock budgets: Only everything else budget (new user scenario)
      mockGet.mockResolvedValueOnce({
        size: 1,
        docs: [
          {
            id: 'budget-everything-else',
            data: () => ({
              name: 'Everything Else',
              startDate: twoMonthsAgo,
              isOngoing: true,
              isSystemEverythingElse: true
            })
          }
        ]
      });

      const transactions = [createMockTransaction(oneMonthAgo)];
      const result = await matchTransactionSplitsToBudgets(transactions, userId);

      expect(result[0].splits[0].budgetId).toBe('budget-everything-else');
    });
  });

  describe('Graceful Degradation', () => {
    test('should remain unassigned when no everything else budget exists', async () => {
      // Mock budgets: Regular budget with non-matching range, NO everything else
      mockGet.mockResolvedValueOnce({
        size: 1,
        docs: [
          {
            id: 'budget-future',
            data: () => ({
              name: 'Future Budget',
              startDate: Timestamp.fromMillis(now.toMillis() + 30 * 24 * 60 * 60 * 1000),
              isOngoing: true,
              isSystemEverythingElse: false
            })
          }
        ]
      });

      const transactions = [createMockTransaction(oneMonthAgo)];
      const result = await matchTransactionSplitsToBudgets(transactions, userId);

      // Should remain unassigned
      expect(result[0].splits[0].budgetId).toBe('unassigned');
    });

    test('should remain unassigned when no budgets exist at all', async () => {
      // Mock budgets: Empty (edge case)
      mockGet.mockResolvedValueOnce({
        size: 0,
        docs: []
      });

      const transactions = [createMockTransaction(oneMonthAgo)];
      const result = await matchTransactionSplitsToBudgets(transactions, userId);

      expect(result[0].splits[0].budgetId).toBe('unassigned');
    });
  });

  describe('Budget Separation Logic', () => {
    test('should correctly separate system budget from regular budgets', async () => {
      mockGet.mockResolvedValueOnce({
        size: 3,
        docs: [
          {
            id: 'budget-groceries',
            data: () => ({
              name: 'Groceries',
              startDate: twoMonthsAgo,
              isOngoing: true,
              isSystemEverythingElse: false
            })
          },
          {
            id: 'budget-everything-else',
            data: () => ({
              name: 'Everything Else',
              startDate: twoMonthsAgo,
              isOngoing: true,
              isSystemEverythingElse: true
            })
          },
          {
            id: 'budget-dining',
            data: () => ({
              name: 'Dining Out',
              startDate: twoMonthsAgo,
              isOngoing: true,
              isSystemEverythingElse: false
            })
          }
        ]
      });

      const transactions = [createMockTransaction(oneMonthAgo)];
      await matchTransactionSplitsToBudgets(transactions, userId);

      // Verify query was made
      expect(mockCollection).toHaveBeenCalledWith('budgets');
      expect(mockWhere).toHaveBeenCalledWith('createdBy', '==', userId);
      expect(mockWhere).toHaveBeenCalledWith('isActive', '==', true);
    });

    test('should handle missing isSystemEverythingElse field (defaults to false)', async () => {
      // Mock budget without isSystemEverythingElse field
      mockGet.mockResolvedValueOnce({
        size: 1,
        docs: [
          {
            id: 'budget-legacy',
            data: () => ({
              name: 'Legacy Budget',
              startDate: twoMonthsAgo,
              isOngoing: true
              // isSystemEverythingElse field missing
            })
          }
        ]
      });

      const transactions = [createMockTransaction(oneMonthAgo)];
      const result = await matchTransactionSplitsToBudgets(transactions, userId);

      // Should treat as regular budget and match it
      expect(result[0].splits[0].budgetId).toBe('budget-legacy');
    });
  });

  describe('Multiple Transactions', () => {
    test('should handle mix of matched and unmatched transactions', async () => {
      const threeMonthsAgo = Timestamp.fromMillis(now.toMillis() - 90 * 24 * 60 * 60 * 1000);

      mockGet.mockResolvedValueOnce({
        size: 2,
        docs: [
          {
            id: 'budget-groceries',
            data: () => ({
              name: 'Groceries',
              startDate: twoMonthsAgo,
              endDate: now,
              isOngoing: false,
              isSystemEverythingElse: false
            })
          },
          {
            id: 'budget-everything-else',
            data: () => ({
              name: 'Everything Else',
              startDate: threeMonthsAgo,
              isOngoing: true,
              isSystemEverythingElse: true
            })
          }
        ]
      });

      const transactions = [
        createMockTransaction(oneMonthAgo, 'txn-1'),     // Within groceries range
        createMockTransaction(threeMonthsAgo, 'txn-2')   // Before groceries, but within everything else
      ];

      const result = await matchTransactionSplitsToBudgets(transactions, userId);

      // First transaction matches regular budget
      expect(result[0].splits[0].budgetId).toBe('budget-groceries');

      // Second transaction falls back to everything else
      expect(result[1].splits[0].budgetId).toBe('budget-everything-else');
    });

    test('should match all transactions to everything else when no regular budgets match', async () => {
      mockGet.mockResolvedValueOnce({
        size: 1,
        docs: [
          {
            id: 'budget-everything-else',
            data: () => ({
              name: 'Everything Else',
              startDate: twoMonthsAgo,
              isOngoing: true,
              isSystemEverythingElse: true
            })
          }
        ]
      });

      const transactions = [
        createMockTransaction(oneMonthAgo, 'txn-1'),
        createMockTransaction(now, 'txn-2'),
        createMockTransaction(twoMonthsAgo, 'txn-3')
      ];

      const result = await matchTransactionSplitsToBudgets(transactions, userId);

      // All should match everything else
      result.forEach(txn => {
        expect(txn.splits[0].budgetId).toBe('budget-everything-else');
      });
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty transaction array', async () => {
      const transactions: FamilyTransaction[] = [];
      const result = await matchTransactionSplitsToBudgets(transactions, userId);

      expect(result).toEqual([]);
      expect(mockGet).not.toHaveBeenCalled(); // Should skip query
    });

    test('should handle transaction with multiple splits', async () => {
      mockGet.mockResolvedValueOnce({
        size: 1,
        docs: [
          {
            id: 'budget-everything-else',
            data: () => ({
              name: 'Everything Else',
              startDate: twoMonthsAgo,
              isOngoing: true,
              isSystemEverythingElse: true
            })
          }
        ]
      });

      const transactionWithMultipleSplits = {
        ...createMockTransaction(oneMonthAgo),
        splits: [
          { amount: 60, budgetId: 'unassigned', categoryId: 'food', updatedAt: now },
          { amount: 40, budgetId: 'unassigned', categoryId: 'transport', updatedAt: now }
        ]
      };

      const transactions = [transactionWithMultipleSplits as any];
      const result = await matchTransactionSplitsToBudgets(transactions, userId);

      // All splits should get the same budget ID
      expect(result[0].splits[0].budgetId).toBe('budget-everything-else');
      expect(result[0].splits[1].budgetId).toBe('budget-everything-else');
    });

    test('should update split timestamps', async () => {
      mockGet.mockResolvedValueOnce({
        size: 1,
        docs: [
          {
            id: 'budget-everything-else',
            data: () => ({
              name: 'Everything Else',
              startDate: twoMonthsAgo,
              isOngoing: true,
              isSystemEverythingElse: true
            })
          }
        ]
      });

      const oldTimestamp = Timestamp.fromMillis(now.toMillis() - 10000);
      const transaction = {
        ...createMockTransaction(oneMonthAgo),
        splits: [{ amount: 100, budgetId: 'unassigned', categoryId: 'food', updatedAt: oldTimestamp }]
      };

      const transactions = [transaction as any];
      const result = await matchTransactionSplitsToBudgets(transactions, userId);

      // Timestamp should be updated
      expect(result[0].splits[0].updatedAt.toMillis()).toBeGreaterThan(oldTimestamp.toMillis());
    });
  });

  describe('Error Handling', () => {
    test('should return original transactions on query error', async () => {
      const queryError = new Error('Firestore query failed');
      mockGet.mockRejectedValueOnce(queryError);

      const transactions = [createMockTransaction(oneMonthAgo)];
      const originalBudgetId = transactions[0].splits[0].budgetId;

      const result = await matchTransactionSplitsToBudgets(transactions, userId);

      // Should return original array with unassigned
      expect(result[0].splits[0].budgetId).toBe(originalBudgetId);
    });

    test('should handle malformed budget data gracefully', async () => {
      mockGet.mockResolvedValueOnce({
        size: 2,
        docs: [
          {
            id: 'budget-malformed',
            data: () => ({
              name: 'Malformed Budget'
              // Missing startDate and isOngoing
            })
          },
          {
            id: 'budget-everything-else',
            data: () => ({
              name: 'Everything Else',
              startDate: twoMonthsAgo,
              isOngoing: true,
              isSystemEverythingElse: true
            })
          }
        ]
      });

      const transactions = [createMockTransaction(oneMonthAgo)];
      const result = await matchTransactionSplitsToBudgets(transactions, userId);

      // Should skip malformed budget and fallback to everything else
      expect(result[0].splits[0].budgetId).toBe('budget-everything-else');
    });
  });

  describe('Logging', () => {
    test('should log when transaction is assigned to everything else budget', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      mockGet.mockResolvedValueOnce({
        size: 1,
        docs: [
          {
            id: 'budget-everything-else',
            data: () => ({
              name: 'Everything Else',
              startDate: twoMonthsAgo,
              isOngoing: true,
              isSystemEverythingElse: true
            })
          }
        ]
      });

      const transactions = [createMockTransaction(oneMonthAgo)];
      await matchTransactionSplitsToBudgets(transactions, userId);

      expect(consoleLogSpy).toHaveBeenCalled();
      consoleLogSpy.mockRestore();
    });
  });
});
