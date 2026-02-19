/**
 * Unit Tests for Budget Deletion Transaction Reassignment
 *
 * Tests the reassignTransactionsFromDeletedBudget utility with mocked Firestore.
 * Following the budgetSpending.test.ts pattern for consistency.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { reassignTransactionsFromDeletedBudget } from '../reassignTransactionsFromDeletedBudget';

// Mock Firestore
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn(),
  Timestamp: {
    now: jest.fn(() => ({ toDate: () => new Date() })),
    fromDate: jest.fn((date: Date) => ({
      toDate: () => date,
      toMillis: () => date.getTime()
    }))
  }
}));

import { getFirestore } from 'firebase-admin/firestore';

describe('reassignTransactionsFromDeletedBudget', () => {
  const mockUserId = 'user_test_001';
  const deletedBudgetId = 'budget_to_delete';

  let mockDb: any;
  let mockBatch: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock batch operations
    mockBatch = {
      update: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined)
    };

    // Mock Firestore instance
    mockDb = {
      collection: jest.fn(),
      batch: jest.fn(() => mockBatch)
    };

    (getFirestore as jest.Mock).mockReturnValue(mockDb);
  });

  // Helper to create mock budget document
  const createMockBudget = (id: string, overrides?: any) => ({
    id,
    exists: true,
    data: () => ({
      id,
      userId: mockUserId,
      name: `Budget ${id}`,
      isActive: true,
      startDate: Timestamp.fromDate(new Date('2025-01-01')),
      isOngoing: true,
      categoryIds: [],
      ...overrides
    })
  });

  // Helper to create mock QuerySnapshot with forEach method
  const createMockSnapshot = (docs: any[]) => ({
    docs,
    size: docs.length,
    empty: docs.length === 0,
    forEach: (callback: (doc: any) => void) => docs.forEach(callback)
  });

  // Helper to create mock transaction document
  const createMockTransaction = (id: string, budgetId: string, date: Date = new Date('2025-01-15')) => ({
    id,
    ref: { update: jest.fn() },
    data: () => ({
      id,
      ownerId: mockUserId,
      transactionDate: Timestamp.fromDate(date),
      amount: 25.00,
      splits: [{
        splitId: `split_${id}`,
        budgetId,
        amount: 25.00,
        isDefault: true,
        plaidPrimaryCategory: 'Transportation',
        updatedAt: Timestamp.now()
      }]
    })
  });

  describe('Basic Reassignment', () => {
    it('reassigns all transactions from deleted budget to date-matched budgets', async () => {
      // Mock budget query
      const deletedBudgetDoc = createMockBudget(deletedBudgetId, { isActive: false });
      mockDb.collection.mockImplementation((collectionName: string) => {
        if (collectionName === 'budgets') {
          return {
            doc: jest.fn(() => ({
              get: jest.fn().mockResolvedValue(deletedBudgetDoc)
            })),
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([
              createMockBudget('budget_transportation_new', {
                startDate: Timestamp.fromDate(new Date('2025-01-01')),
                isOngoing: true
              })
            ]))
          };
        }

        if (collectionName === 'transactions') {
          return {
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot(
              Array.from({ length: 10 }, (_, i) =>
                createMockTransaction(`txn_test_${i}`, deletedBudgetId)
              )
            ))
          };
        }

        return {};
      });

      const result = await reassignTransactionsFromDeletedBudget(deletedBudgetId, mockUserId);

      expect(result.success).toBe(true);
      expect(result.transactionsReassigned).toBe(10);
      expect(result.budgetAssignments['budget_transportation_new']).toBe(10);
      expect(mockBatch.commit).toHaveBeenCalled();
    });

    it('handles transactions with no splits gracefully', async () => {
      const deletedBudgetDoc = createMockBudget(deletedBudgetId, { isActive: false });

      mockDb.collection.mockImplementation((collectionName: string) => {
        if (collectionName === 'budgets') {
          return {
            doc: jest.fn(() => ({
              get: jest.fn().mockResolvedValue(deletedBudgetDoc)
            })),
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([]))
          };
        }

        if (collectionName === 'transactions') {
          return {
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([{
              id: 'txn_no_splits',
              data: () => ({
                id: 'txn_no_splits',
                ownerId: mockUserId,
                splits: [] // Empty splits array
              })
            }]))
          };
        }

        return {};
      });

      const result = await reassignTransactionsFromDeletedBudget(deletedBudgetId, mockUserId);

      expect(result.transactionsReassigned).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Fallback to "Everything Else"', () => {
    it('assigns to Everything Else when no date-matched budget exists', async () => {
      const deletedBudgetDoc = createMockBudget(deletedBudgetId, { isActive: false });

      mockDb.collection.mockImplementation((collectionName: string) => {
        if (collectionName === 'budgets') {
          return {
            doc: jest.fn(() => ({
              get: jest.fn().mockResolvedValue(deletedBudgetDoc)
            })),
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([
              createMockBudget('budget_everything_else', {
                isSystemEverythingElse: true,
                categoryIds: [],
                isOngoing: true
              })
            ]))
          };
        }

        if (collectionName === 'transactions') {
          return {
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([
              createMockTransaction('txn_future', deletedBudgetId, new Date('2025-12-25'))
            ]))
          };
        }

        return {};
      });

      const result = await reassignTransactionsFromDeletedBudget(deletedBudgetId, mockUserId);

      expect(result.budgetAssignments['budget_everything_else']).toBe(1);
    });

    it('marks splits as unassigned when no Everything Else budget exists', async () => {
      const deletedBudgetDoc = createMockBudget(deletedBudgetId, { isActive: false });

      mockDb.collection.mockImplementation((collectionName: string) => {
        if (collectionName === 'budgets') {
          return {
            doc: jest.fn(() => ({
              get: jest.fn().mockResolvedValue(deletedBudgetDoc)
            })),
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([])) // No budgets
          };
        }

        if (collectionName === 'transactions') {
          return {
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([
              createMockTransaction('txn_orphan', deletedBudgetId)
            ]))
          };
        }

        return {};
      });

      const result = await reassignTransactionsFromDeletedBudget(deletedBudgetId, mockUserId);

      expect(result.transactionsReassigned).toBe(1);
      expect(result.budgetAssignments['unassigned']).toBe(1);
    });
  });

  describe('Batch Processing', () => {
    it('handles 600 transactions with proper batching (500-doc limit)', async () => {
      const deletedBudgetDoc = createMockBudget(deletedBudgetId, { isActive: false });

      mockDb.collection.mockImplementation((collectionName: string) => {
        if (collectionName === 'budgets') {
          return {
            doc: jest.fn(() => ({
              get: jest.fn().mockResolvedValue(deletedBudgetDoc)
            })),
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([
              createMockBudget('budget_new')
            ]))
          };
        }

        if (collectionName === 'transactions') {
          return {
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot(
              Array.from({ length: 600 }, (_, i) =>
                createMockTransaction(`txn_batch_${i}`, deletedBudgetId)
              )
            ))
          };
        }

        return {};
      });

      const result = await reassignTransactionsFromDeletedBudget(deletedBudgetId, mockUserId);

      expect(result.transactionsReassigned).toBe(600);
      // Should use 2 batches: 500 + 100
      expect(mockBatch.commit).toHaveBeenCalledTimes(2);
    });
  });

  describe('Multi-Split Transactions', () => {
    it('only reassigns splits from deleted budget, preserves other splits', async () => {
      const deletedBudgetDoc = createMockBudget(deletedBudgetId, { isActive: false });

      const multiSplitTxn = {
        id: 'txn_multi_split',
        ref: { update: jest.fn() },
        data: () => ({
          id: 'txn_multi_split',
          ownerId: mockUserId,
          transactionDate: Timestamp.fromDate(new Date('2025-01-15')),
          amount: 100.00,
          splits: [
            {
              splitId: 'split_001',
              budgetId: deletedBudgetId, // This one gets reassigned
              amount: 60.00,
              plaidPrimaryCategory: 'Food',
              updatedAt: Timestamp.now()
            },
            {
              splitId: 'split_002',
              budgetId: 'budget_other', // This one stays
              amount: 40.00,
              plaidPrimaryCategory: 'Transportation',
              updatedAt: Timestamp.now()
            }
          ]
        })
      };

      mockDb.collection.mockImplementation((collectionName: string) => {
        if (collectionName === 'budgets') {
          return {
            doc: jest.fn(() => ({
              get: jest.fn().mockResolvedValue(deletedBudgetDoc)
            })),
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([
              createMockBudget('budget_new')
            ]))
          };
        }

        if (collectionName === 'transactions') {
          return {
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([
              multiSplitTxn
            ]))
          };
        }

        return {};
      });

      const result = await reassignTransactionsFromDeletedBudget(deletedBudgetId, mockUserId);

      expect(result.transactionsReassigned).toBe(1);
      // Verify only deleted budget splits counted
      expect(result.budgetAssignments['budget_new']).toBe(1);
    });

    it('handles all splits from deleted budget in same transaction', async () => {
      const deletedBudgetDoc = createMockBudget(deletedBudgetId, { isActive: false });

      const allDeletedSplitsTxn = {
        id: 'txn_all_deleted',
        ref: { update: jest.fn() },
        data: () => ({
          id: 'txn_all_deleted',
          ownerId: mockUserId,
          transactionDate: Timestamp.fromDate(new Date('2025-01-15')),
          amount: 100.00,
          splits: [
            {
              splitId: 'split_001',
              budgetId: deletedBudgetId,
              amount: 50.00,
              plaidPrimaryCategory: 'Food',
              updatedAt: Timestamp.now()
            },
            {
              splitId: 'split_002',
              budgetId: deletedBudgetId,
              amount: 50.00,
              plaidPrimaryCategory: 'Transportation',
              updatedAt: Timestamp.now()
            }
          ]
        })
      };

      mockDb.collection.mockImplementation((collectionName: string) => {
        if (collectionName === 'budgets') {
          return {
            doc: jest.fn(() => ({
              get: jest.fn().mockResolvedValue(deletedBudgetDoc)
            })),
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([
              createMockBudget('budget_new')
            ]))
          };
        }

        if (collectionName === 'transactions') {
          return {
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([
              allDeletedSplitsTxn
            ]))
          };
        }

        return {};
      });

      const result = await reassignTransactionsFromDeletedBudget(deletedBudgetId, mockUserId);

      expect(result.transactionsReassigned).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('returns error when deleted budget does not exist', async () => {
      mockDb.collection.mockImplementation((collectionName: string) => {
        if (collectionName === 'budgets') {
          return {
            doc: jest.fn(() => ({
              get: jest.fn().mockResolvedValue({
                exists: false,
                data: () => null
              })
            }))
          };
        }
        return {};
      });

      const result = await reassignTransactionsFromDeletedBudget('nonexistent_budget', mockUserId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Budget not found');
    });

    it('returns error when budget is not deleted (isActive=true)', async () => {
      const activeBudgetDoc = createMockBudget(deletedBudgetId, { isActive: true });

      mockDb.collection.mockImplementation((collectionName: string) => {
        if (collectionName === 'budgets') {
          return {
            doc: jest.fn(() => ({
              get: jest.fn().mockResolvedValue(activeBudgetDoc)
            }))
          };
        }
        return {};
      });

      const result = await reassignTransactionsFromDeletedBudget(deletedBudgetId, mockUserId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not deleted');
    });

    it('handles partial failures gracefully', async () => {
      const deletedBudgetDoc = createMockBudget(deletedBudgetId, { isActive: false });

      // Make batch commit fail on first call, succeed on second
      let callCount = 0;
      mockBatch.commit.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('Batch write failed'));
        }
        return Promise.resolve();
      });

      mockDb.collection.mockImplementation((collectionName: string) => {
        if (collectionName === 'budgets') {
          return {
            doc: jest.fn(() => ({
              get: jest.fn().mockResolvedValue(deletedBudgetDoc)
            })),
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([
              createMockBudget('budget_new')
            ]))
          };
        }

        if (collectionName === 'transactions') {
          return {
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot(
              Array.from({ length: 600 }, (_, i) =>
                createMockTransaction(`txn_${i}`, deletedBudgetId)
              )
            ))
          };
        }

        return {};
      });

      const result = await reassignTransactionsFromDeletedBudget(deletedBudgetId, mockUserId);

      // Should have logged error but continued
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
