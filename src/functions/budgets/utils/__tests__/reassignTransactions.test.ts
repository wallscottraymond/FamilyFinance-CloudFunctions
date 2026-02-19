/**
 * Unit Tests for Enhanced Category Reassignment
 *
 * Tests the reassignTransactionsForBudget utility with mocked Firestore.
 * Following the budgetSpending.test.ts pattern for consistency.
 *
 * Key requirement: When categories are REMOVED, re-evaluate ALL splits in affected
 * transactions, not just splits matching the removed category.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { reassignTransactionsForBudget, ReassignmentStats } from '../reassignTransactions';

// Mock Firebase Admin
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  credential: {
    applicationDefault: jest.fn()
  },
  firestore: jest.fn(() => ({
    settings: jest.fn()
  }))
}));

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

// Mock matchTransactionSplitsToBudgets
jest.mock('../../transactions/utils/matchTransactionSplitsToBudgets', () => ({
  matchTransactionSplitsToBudgets: jest.fn()
}));

import { getFirestore } from 'firebase-admin/firestore';
import { matchTransactionSplitsToBudgets } from '../../transactions/utils/matchTransactionSplitsToBudgets';

describe('reassignTransactionsForBudget - Enhanced Category Logic', () => {
  const mockUserId = 'user_test_001';

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

    // Default mock for matchTransactionSplitsToBudgets - returns transactions with reassigned splits
    (matchTransactionSplitsToBudgets as jest.Mock).mockImplementation(async (transactions: any[]) => {
      // By default, reassign the first split to a new budget (simulating category matching)
      return transactions.map(txn => ({
        ...txn,
        splits: txn.splits.map((split: any, index: number) => ({
          ...split,
          budgetId: index === 0 ? 'budget_reassigned' : split.budgetId,
          updatedAt: Timestamp.now()
        }))
      }));
    });
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

  // Helper to create mock transaction document
  const createMockTransaction = (id: string, splits: any[], overrides?: any) => ({
    id,
    ref: { update: jest.fn() },
    data: () => ({
      id,
      ownerId: mockUserId,
      transactionDate: Timestamp.fromDate(new Date('2025-01-15')),
      amount: 100.00,
      splits,
      isActive: true,
      createdAt: Timestamp.now(),
      ...overrides
    })
  });

  // Helper to create mock split
  const createMockSplit = (splitId: string, budgetId: string, category: string, amount: number = 50.00) => ({
    splitId,
    budgetId,
    amount,
    internalPrimaryCategory: category,
    isDefault: true,
    plaidPrimaryCategory: category,
    plaidDetailedCategory: category,
    internalDetailedCategory: null,
    isIgnored: false,
    isRefund: false,
    isTaxDeductible: false,
    paymentDate: Timestamp.fromDate(new Date('2025-01-15')),
    monthlyPeriodId: null,
    weeklyPeriodId: null,
    biWeeklyPeriodId: null,
    rules: [],
    tags: [],
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now()
  });

  // Helper to create mock QuerySnapshot with forEach method
  const createMockSnapshot = (docs: any[]) => ({
    docs,
    size: docs.length,
    empty: docs.length === 0,
    forEach: (callback: (doc: any) => void) => docs.forEach(callback)
  });

  describe('Category Additions', () => {
    it('picks up unassigned transactions matching new categories', async () => {
      // Setup: Budget with only Food category initially
      const budget = createMockBudget('budget_combo', {
        categoryIds: ['cat_food_001']
      });

      const everythingElseBudget = createMockBudget('budget_everything_else', {
        categoryIds: [],
        isSystemEverythingElse: true
      });

      // Transaction with Transportation split in "Everything Else"
      const transportationSplit = createMockSplit('split_gas', 'budget_everything_else', 'TRANSPORTATION');
      const transportationTxn = createMockTransaction('txn_gas_001', [transportationSplit]);

      // Mock matchTransactionSplitsToBudgets to reassign to budget_combo
      (matchTransactionSplitsToBudgets as jest.Mock).mockResolvedValueOnce([{
        ...transportationTxn.data(),
        splits: [{
          ...transportationSplit,
          budgetId: 'budget_combo',  // Reassigned from everything_else to combo
          updatedAt: Timestamp.now()
        }]
      }]);

      mockDb.collection.mockImplementation((collectionName: string) => {
        if (collectionName === 'budgets') {
          return {
            doc: jest.fn((docId: string) => ({
              get: jest.fn().mockResolvedValue(
                docId === 'budget_combo' ? budget : everythingElseBudget
              )
            })),
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([budget, everythingElseBudget]))
          };
        }

        if (collectionName === 'transactions') {
          return {
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([transportationTxn]))
          };
        }

        return {};
      });

      // Execute: User adds Transportation category to budget
      const result = await reassignTransactionsForBudget(
        'budget_combo',
        mockUserId,
        {
          categoriesAdded: ['cat_transportation_001'],
          categoriesRemoved: []
        }
      ) as ReassignmentStats;

      expect(result.transactionsReassigned).toBe(1);
    });

    it('does not reassign transactions already in other specific budgets', async () => {
      const budget = createMockBudget('budget_combo', {
        categoryIds: ['cat_food_001']
      });

      const transportationBudget = createMockBudget('budget_transportation', {
        categoryIds: ['cat_transportation_001']
      });

      // Transaction already in specific transportation budget
      const transportationSplit = createMockSplit('split_gas', 'budget_transportation', 'TRANSPORTATION');
      const transportationTxn = createMockTransaction('txn_gas', [transportationSplit]);

      mockDb.collection.mockImplementation((collectionName: string) => {
        if (collectionName === 'budgets') {
          return {
            doc: jest.fn((docId: string) => ({
              get: jest.fn().mockResolvedValue(
                docId === 'budget_combo' ? budget : transportationBudget
              )
            })),
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([budget, transportationBudget]))
          };
        }

        if (collectionName === 'transactions') {
          return {
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([transportationTxn]))
          };
        }

        return {};
      });

      const result = await reassignTransactionsForBudget(
        'budget_combo',
        mockUserId,
        {
          categoriesAdded: ['cat_transportation_001'],
          categoriesRemoved: []
        }
      ) as ReassignmentStats;

      // Should NOT reassign (already in specific budget)
      expect(result.transactionsReassigned).toBe(0);
    });
  });

  describe('Category Removals - Full Re-evaluation', () => {
    it('re-evaluates ALL splits in affected transactions, not just removed category', async () => {
      const groceriesBudget = createMockBudget('budget_groceries', {
        categoryIds: ['cat_food_001', 'cat_household_001']
      });

      const householdBudget = createMockBudget('budget_household_separate', {
        categoryIds: ['cat_household_001']
      });

      // Multi-split transaction: Food + Household both in groceries budget
      const foodSplit = createMockSplit('split_food', 'budget_groceries', 'FOOD', 60.00);
      const householdSplit = createMockSplit('split_household', 'budget_groceries', 'HOUSEHOLD', 40.00);
      const multiSplitTxn = createMockTransaction('txn_walmart_multi', [foodSplit, householdSplit]);

      // Mock matchTransactionSplitsToBudgets to reassign household split
      (matchTransactionSplitsToBudgets as jest.Mock).mockResolvedValueOnce([{
        ...multiSplitTxn.data(),
        splits: [
          { ...foodSplit, budgetId: 'budget_groceries', updatedAt: Timestamp.now() },  // Food stays
          { ...householdSplit, budgetId: 'budget_household_separate', updatedAt: Timestamp.now() }  // Household reassigned
        ]
      }]);

      mockDb.collection.mockImplementation((collectionName: string) => {
        if (collectionName === 'budgets') {
          return {
            doc: jest.fn((docId: string) => ({
              get: jest.fn().mockResolvedValue(
                docId === 'budget_groceries' ? groceriesBudget : householdBudget
              )
            })),
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([groceriesBudget, householdBudget]))
          };
        }

        if (collectionName === 'transactions') {
          return {
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([multiSplitTxn]))
          };
        }

        return {};
      });

      // Remove household category from groceries budget
      const result = await reassignTransactionsForBudget(
        'budget_groceries',
        mockUserId,
        {
          categoriesAdded: [],
          categoriesRemoved: ['cat_household_001']
        }
      ) as ReassignmentStats;

      expect(result.transactionsReassigned).toBe(1);
    });

    it('re-evaluates transaction even when only one split has removed category', async () => {
      const combinedBudget = createMockBudget('budget_combined', {
        categoryIds: ['cat_food_001', 'cat_entertainment_001']
      });

      const entertainmentBudget = createMockBudget('budget_entertainment', {
        categoryIds: ['cat_entertainment_001']
      });

      // Transaction with Food + Entertainment splits
      const foodSplit = createMockSplit('split_food', 'budget_combined', 'FOOD', 50.00);
      const entertainmentSplit = createMockSplit('split_entertainment', 'budget_combined', 'ENTERTAINMENT', 100.00);
      const mixedTxn = createMockTransaction('txn_mixed', [foodSplit, entertainmentSplit]);

      // Mock matchTransactionSplitsToBudgets to reassign entertainment split
      (matchTransactionSplitsToBudgets as jest.Mock).mockResolvedValueOnce([{
        ...mixedTxn.data(),
        splits: [
          { ...foodSplit, budgetId: 'budget_combined', updatedAt: Timestamp.now() },  // Food stays
          { ...entertainmentSplit, budgetId: 'budget_entertainment', updatedAt: Timestamp.now() }  // Entertainment reassigned
        ]
      }]);

      mockDb.collection.mockImplementation((collectionName: string) => {
        if (collectionName === 'budgets') {
          return {
            doc: jest.fn((docId: string) => ({
              get: jest.fn().mockResolvedValue(
                docId === 'budget_combined' ? combinedBudget : entertainmentBudget
              )
            })),
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([combinedBudget, entertainmentBudget]))
          };
        }

        if (collectionName === 'transactions') {
          return {
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([mixedTxn]))
          };
        }

        return {};
      });

      const result = await reassignTransactionsForBudget(
        'budget_combined',
        mockUserId,
        {
          categoriesAdded: [],
          categoriesRemoved: ['cat_entertainment_001']
        }
      ) as ReassignmentStats;

      expect(result.transactionsReassigned).toBe(1);
    });

    it('handles cascading reassignments when multiple budgets overlap', async () => {
      const budgetA = createMockBudget('budget_a', {
        categoryIds: ['cat_food_001', 'cat_entertainment_001']
      });

      const budgetB = createMockBudget('budget_b', {
        categoryIds: ['cat_food_001']
      });

      const budgetC = createMockBudget('budget_c', {
        categoryIds: ['cat_entertainment_001']
      });

      // Transaction with entertainment split in budget A
      const entertainmentSplit = createMockSplit('split_entertainment', 'budget_a', 'ENTERTAINMENT', 75.00);
      const cascadeTxn = createMockTransaction('txn_cascade', [entertainmentSplit]);

      // Mock matchTransactionSplitsToBudgets to reassign to budget C
      (matchTransactionSplitsToBudgets as jest.Mock).mockResolvedValueOnce([{
        ...cascadeTxn.data(),
        splits: [
          { ...entertainmentSplit, budgetId: 'budget_c', updatedAt: Timestamp.now() }  // Reassigned from A to C
        ]
      }]);

      mockDb.collection.mockImplementation((collectionName: string) => {
        if (collectionName === 'budgets') {
          return {
            doc: jest.fn((docId: string) => ({
              get: jest.fn().mockResolvedValue(
                docId === 'budget_a' ? budgetA :
                docId === 'budget_b' ? budgetB : budgetC
              )
            })),
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([budgetA, budgetB, budgetC]))
          };
        }

        if (collectionName === 'transactions') {
          return {
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([cascadeTxn]))
          };
        }

        return {};
      });

      const result = await reassignTransactionsForBudget(
        'budget_a',
        mockUserId,
        {
          categoriesAdded: [],
          categoriesRemoved: ['cat_entertainment_001']
        }
      ) as ReassignmentStats;

      expect(result.transactionsReassigned).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('returns error when budget does not exist', async () => {
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

      const result = await reassignTransactionsForBudget(
        'nonexistent_budget',
        mockUserId,
        {
          categoriesAdded: ['cat_food_001'],
          categoriesRemoved: []
        }
      ) as ReassignmentStats;

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Budget not found');
    });

    it('handles empty category changes gracefully', async () => {
      const budget = createMockBudget('budget_test', {
        categoryIds: ['cat_food_001']
      });

      mockDb.collection.mockImplementation((collectionName: string) => {
        if (collectionName === 'budgets') {
          return {
            doc: jest.fn(() => ({
              get: jest.fn().mockResolvedValue(budget)
            })),
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([]))
          };
        }

        if (collectionName === 'transactions') {
          return {
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([]))
          };
        }

        return {};
      });

      const result = await reassignTransactionsForBudget(
        'budget_test',
        mockUserId,
        {
          categoriesAdded: [],
          categoriesRemoved: []
        }
      ) as ReassignmentStats;

      expect(result.success).toBe(true);
      expect(result.transactionsReassigned).toBe(0);
    });

    it('continues on partial failures', async () => {
      const budget = createMockBudget('budget_partial', {
        categoryIds: ['cat_food_001']
      });

      // Valid transaction
      const validSplit = createMockSplit('split_valid', 'budget_partial', 'FOOD');
      const validTxn = createMockTransaction('txn_valid', [validSplit]);

      // Invalid transaction (missing date)
      const invalidTxn = createMockTransaction('txn_invalid', [validSplit], {
        transactionDate: null  // Missing date
      });

      mockDb.collection.mockImplementation((collectionName: string) => {
        if (collectionName === 'budgets') {
          return {
            doc: jest.fn(() => ({
              get: jest.fn().mockResolvedValue(budget)
            })),
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([budget]))
          };
        }

        if (collectionName === 'transactions') {
          return {
            where: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(createMockSnapshot([validTxn, invalidTxn]))
          };
        }

        return {};
      });

      const result = await reassignTransactionsForBudget(
        'budget_partial',
        mockUserId,
        {
          categoriesAdded: [],
          categoriesRemoved: ['cat_food_001']
        }
      ) as ReassignmentStats;

      expect(result.transactionsReassigned).toBe(1);  // Only valid one
      expect(result.errors).toHaveLength(1);  // One error
      expect(result.errors[0]).toContain('txn_invalid');
    });
  });
});
