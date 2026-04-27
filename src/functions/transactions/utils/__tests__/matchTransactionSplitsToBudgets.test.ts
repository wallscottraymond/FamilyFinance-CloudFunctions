/**
 * Comprehensive Tests for matchTransactionSplitsToBudgets
 *
 * Tests the critical budget assignment logic that determines which budget
 * each transaction split is assigned to. This is a keystone component of
 * the budget tracking system.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { matchTransactionSplitsToBudgets } from '../matchTransactionSplitsToBudgets';
import { Transaction as FamilyTransaction, TransactionStatus, TransactionType } from '../../../../types';

// Mock Firestore
jest.mock('../../../../index', () => ({
  db: {
    collection: jest.fn()
  }
}));

import { db } from '../../../../index';

describe('matchTransactionSplitsToBudgets', () => {
  const mockUserId = 'user_test_001';

  // Helper to create realistic transaction with all 18 split fields
  const createTransaction = (
    date: Date,
    amount: number,
    overrides?: Partial<FamilyTransaction>
  ): FamilyTransaction => {
    const txnId = `txn_${Date.now()}`;
    return {
    id: txnId,
    transactionId: txnId,
    ownerId: mockUserId,
    groupId: null,
    transactionDate: Timestamp.fromDate(date),
    accountId: 'account_test',
    createdBy: mockUserId,
    updatedBy: mockUserId,
    currency: 'USD',
    description: 'Test Transaction',
    internalDetailedCategory: null,
    internalPrimaryCategory: null,
    plaidDetailedCategory: 'GENERAL_MERCHANDISE_OTHER',
    plaidPrimaryCategory: 'GENERAL_MERCHANDISE',
    plaidItemId: 'item_test',
    source: 'manual',
    transactionStatus: TransactionStatus.APPROVED,
    type: TransactionType.EXPENSE,
    name: 'Test Transaction',
    merchantName: null,
    splits: [
      {
        splitId: 'split_001',
        budgetId: 'unassigned',
        amount,
        description: null,
        isDefault: true,
        monthlyPeriodId: null,
        weeklyPeriodId: null,
        biWeeklyPeriodId: null,
        outflowId: null,
        plaidPrimaryCategory: 'GENERAL_MERCHANDISE',
        plaidDetailedCategory: 'GENERAL_MERCHANDISE_OTHER',
        internalPrimaryCategory: null,
        internalDetailedCategory: null,
        isIgnored: false,
        isRefund: false,
        isTaxDeductible: false,
        ignoredReason: null,
        refundReason: null,
        paymentDate: Timestamp.fromDate(date),
        rules: [],
        tags: [],
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      }
    ],
    initialPlaidData: {
      plaidAccountId: 'account_test',
      plaidMerchantName: 'Test Merchant',
      plaidName: 'Test Transaction',
      plaidTransactionId: 'plaid_txn_test',
      plaidPending: false,
      source: 'plaid'
    },
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides
  };
};

  // Helper to create realistic budget
  const createBudget = (
    id: string,
    name: string,
    startDate: Date,
    options: {
      isOngoing?: boolean;
      endDate?: Date;
      isSystemEverythingElse?: boolean;
      categoryIds?: string[];
    } = {}
  ) => ({
    id,
    data: () => ({
      name,
      startDate: Timestamp.fromDate(startDate),
      endDate: options.endDate ? Timestamp.fromDate(options.endDate) : null,
      isOngoing: options.isOngoing !== false,
      isSystemEverythingElse: options.isSystemEverythingElse || false,
      categoryIds: options.categoryIds || []
    })
  });

  // Helper to mock Firestore budget query
  const mockBudgetQuery = (budgets: any[]) => {
    const mockGet = jest.fn().mockResolvedValue({
      size: budgets.length,
      docs: budgets
    });

    const mockWhere = jest.fn().mockReturnThis();

    (db.collection as jest.Mock).mockReturnValue({
      where: mockWhere,
      get: mockGet
    });

    return { mockGet, mockWhere };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Regular Budget Matching (Date + Category)', () => {
    it('should match transaction to budget within date range AND matching category', async () => {
      const budgets = [
        createBudget(
          'budget_groceries',
          'Groceries',
          new Date('2025-01-01'),
          { isOngoing: true, categoryIds: ['GENERAL_MERCHANDISE'] }
        )
      ];

      mockBudgetQuery(budgets);

      const transactions = [
        createTransaction(new Date('2025-01-15'), 50.00)
      ];

      const result = await matchTransactionSplitsToBudgets(transactions, mockUserId);

      expect(result[0].splits[0].budgetId).toBe('budget_groceries');
      expect(result[0].splits[0].budgetName).toBe('Groceries');
    });

    it('should match transaction to budget on exact start date with matching category', async () => {
      const startDate = new Date('2025-01-01');
      const budgets = [
        createBudget('budget_test', 'Test Budget', startDate, {
          isOngoing: true,
          categoryIds: ['GENERAL_MERCHANDISE']
        })
      ];

      mockBudgetQuery(budgets);

      const transactions = [
        createTransaction(startDate, 100.00)
      ];

      const result = await matchTransactionSplitsToBudgets(transactions, mockUserId);

      expect(result[0].splits[0].budgetId).toBe('budget_test');
    });

    it('should NOT match transaction before budget start date', async () => {
      const budgets = [
        createBudget('budget_test', 'Test Budget', new Date('2025-02-01'), {
          isOngoing: true,
          categoryIds: ['GENERAL_MERCHANDISE']
        }),
        createBudget('budget_everything', 'Everything Else', new Date('2024-01-01'), {
          isOngoing: true,
          isSystemEverythingElse: true
        })
      ];

      mockBudgetQuery(budgets);

      const transactions = [
        createTransaction(new Date('2025-01-15'), 50.00)
      ];

      const result = await matchTransactionSplitsToBudgets(transactions, mockUserId);

      // Should fall back to "Everything Else"
      expect(result[0].splits[0].budgetId).toBe('budget_everything');
    });

    it('should match to first budget when multiple budgets match date AND category', async () => {
      const budgets = [
        createBudget('budget_first', 'First Budget', new Date('2025-01-01'), {
          isOngoing: true,
          categoryIds: ['GENERAL_MERCHANDISE']
        }),
        createBudget('budget_second', 'Second Budget', new Date('2025-01-01'), {
          isOngoing: true,
          categoryIds: ['GENERAL_MERCHANDISE']
        })
      ];

      mockBudgetQuery(budgets);

      const transactions = [
        createTransaction(new Date('2025-01-15'), 50.00)
      ];

      const result = await matchTransactionSplitsToBudgets(transactions, mockUserId);

      // First match wins
      expect(result[0].splits[0].budgetId).toBe('budget_first');
      expect(result[0].splits[0].budgetName).toBe('First Budget');
    });
  });

  describe('Category Matching', () => {
    it('should NOT match budget when category does not match', async () => {
      const budgets = [
        createBudget('budget_food', 'Food Budget', new Date('2025-01-01'), {
          isOngoing: true,
          categoryIds: ['FOOD_AND_DRINK'] // Different from transaction's GENERAL_MERCHANDISE
        }),
        createBudget('budget_everything', 'Everything Else', new Date('2024-01-01'), {
          isOngoing: true,
          isSystemEverythingElse: true
        })
      ];

      mockBudgetQuery(budgets);

      const transactions = [
        createTransaction(new Date('2025-01-15'), 50.00) // Has GENERAL_MERCHANDISE category
      ];

      const result = await matchTransactionSplitsToBudgets(transactions, mockUserId);

      // Should fall back to "Everything Else" due to category mismatch
      expect(result[0].splits[0].budgetId).toBe('budget_everything');
    });

    it('should match budget with multiple categoryIds', async () => {
      const budgets = [
        createBudget('budget_shopping', 'Shopping Budget', new Date('2025-01-01'), {
          isOngoing: true,
          categoryIds: ['FOOD_AND_DRINK', 'GENERAL_MERCHANDISE', 'ENTERTAINMENT']
        })
      ];

      mockBudgetQuery(budgets);

      const transactions = [
        createTransaction(new Date('2025-01-15'), 50.00) // Has GENERAL_MERCHANDISE
      ];

      const result = await matchTransactionSplitsToBudgets(transactions, mockUserId);

      expect(result[0].splits[0].budgetId).toBe('budget_shopping');
    });

    it('should prioritize internalPrimaryCategory over plaidPrimaryCategory', async () => {
      const budgets = [
        createBudget('budget_food', 'Food Budget', new Date('2025-01-01'), {
          isOngoing: true,
          categoryIds: ['GROCERIES'] // Matches internal category
        }),
        createBudget('budget_merchandise', 'Merchandise', new Date('2025-01-01'), {
          isOngoing: true,
          categoryIds: ['GENERAL_MERCHANDISE'] // Matches Plaid category
        })
      ];

      mockBudgetQuery(budgets);

      const transaction = createTransaction(new Date('2025-01-15'), 50.00);
      // Set internal category override
      transaction.splits[0].internalPrimaryCategory = 'GROCERIES';

      const result = await matchTransactionSplitsToBudgets([transaction], mockUserId);

      // Should match GROCERIES (internal) not GENERAL_MERCHANDISE (Plaid)
      expect(result[0].splits[0].budgetId).toBe('budget_food');
    });

    it('should NOT match budget with empty categoryIds (user has not configured categories)', async () => {
      const budgets = [
        createBudget('budget_unconfigured', 'Unconfigured Budget', new Date('2025-01-01'), {
          isOngoing: true,
          categoryIds: [] // Empty = not configured
        }),
        createBudget('budget_everything', 'Everything Else', new Date('2024-01-01'), {
          isOngoing: true,
          isSystemEverythingElse: true
        })
      ];

      mockBudgetQuery(budgets);

      const transactions = [
        createTransaction(new Date('2025-01-15'), 50.00)
      ];

      const result = await matchTransactionSplitsToBudgets(transactions, mockUserId);

      // Should fall back to "Everything Else" because unconfigured budget has no categories
      expect(result[0].splits[0].budgetId).toBe('budget_everything');
    });

    it('should match different splits to different budgets based on category', async () => {
      const budgets = [
        createBudget('budget_food', 'Food Budget', new Date('2025-01-01'), {
          isOngoing: true,
          categoryIds: ['FOOD_AND_DRINK']
        }),
        createBudget('budget_shopping', 'Shopping Budget', new Date('2025-01-01'), {
          isOngoing: true,
          categoryIds: ['GENERAL_MERCHANDISE']
        })
      ];

      mockBudgetQuery(budgets);

      const transaction = createTransaction(new Date('2025-01-15'), 100.00);
      // Create multi-split transaction with different categories
      transaction.splits = [
        {
          ...transaction.splits[0],
          splitId: 'split_001',
          amount: 60.00,
          plaidPrimaryCategory: 'FOOD_AND_DRINK',
          internalPrimaryCategory: null
        },
        {
          ...transaction.splits[0],
          splitId: 'split_002',
          amount: 40.00,
          plaidPrimaryCategory: 'GENERAL_MERCHANDISE',
          internalPrimaryCategory: null
        }
      ];

      const result = await matchTransactionSplitsToBudgets([transaction], mockUserId);

      // Each split should match its category-appropriate budget
      expect(result[0].splits[0].budgetId).toBe('budget_food');
      expect(result[0].splits[0].budgetName).toBe('Food Budget');
      expect(result[0].splits[1].budgetId).toBe('budget_shopping');
      expect(result[0].splits[1].budgetName).toBe('Shopping Budget');
    });
  });

  describe('Ongoing vs Limited Budgets', () => {
    it('should match ongoing budget (no end date) for any future transaction', async () => {
      const budgets = [
        createBudget('budget_ongoing', 'Ongoing Budget', new Date('2025-01-01'), {
          isOngoing: true,
          endDate: undefined,
          categoryIds: ['GENERAL_MERCHANDISE']
        })
      ];

      mockBudgetQuery(budgets);

      const transactions = [
        createTransaction(new Date('2030-12-31'), 100.00) // Far future
      ];

      const result = await matchTransactionSplitsToBudgets(transactions, mockUserId);

      expect(result[0].splits[0].budgetId).toBe('budget_ongoing');
    });

    it('should match limited budget within end date', async () => {
      const budgets = [
        createBudget('budget_limited', 'Limited Budget', new Date('2025-01-01'), {
          isOngoing: false,
          endDate: new Date('2025-12-31'),
          categoryIds: ['GENERAL_MERCHANDISE']
        })
      ];

      mockBudgetQuery(budgets);

      const transactions = [
        createTransaction(new Date('2025-06-15'), 75.00)
      ];

      const result = await matchTransactionSplitsToBudgets(transactions, mockUserId);

      expect(result[0].splits[0].budgetId).toBe('budget_limited');
    });

    it('should NOT match limited budget after end date', async () => {
      const budgets = [
        createBudget('budget_limited', 'Limited Budget', new Date('2025-01-01'), {
          isOngoing: false,
          endDate: new Date('2025-12-31'),
          categoryIds: ['GENERAL_MERCHANDISE']
        }),
        createBudget('budget_everything', 'Everything Else', new Date('2024-01-01'), {
          isOngoing: true,
          isSystemEverythingElse: true
        })
      ];

      mockBudgetQuery(budgets);

      const transactions = [
        createTransaction(new Date('2026-01-15'), 50.00) // After end date
      ];

      const result = await matchTransactionSplitsToBudgets(transactions, mockUserId);

      // Should fall back to "Everything Else"
      expect(result[0].splits[0].budgetId).toBe('budget_everything');
    });

    it('should match limited budget on exact end date', async () => {
      const endDate = new Date('2025-12-31');
      const budgets = [
        createBudget('budget_limited', 'Limited Budget', new Date('2025-01-01'), {
          isOngoing: false,
          endDate,
          categoryIds: ['GENERAL_MERCHANDISE']
        })
      ];

      mockBudgetQuery(budgets);

      const transactions = [
        createTransaction(endDate, 100.00)
      ];

      const result = await matchTransactionSplitsToBudgets(transactions, mockUserId);

      expect(result[0].splits[0].budgetId).toBe('budget_limited');
    });
  });

  describe('"Everything Else" Fallback', () => {
    it('should assign to "Everything Else" when no regular budget matches date', async () => {
      const budgets = [
        createBudget('budget_future', 'Future Budget', new Date('2026-01-01'), {
          isOngoing: true,
          categoryIds: ['GENERAL_MERCHANDISE']
        }),
        createBudget('budget_everything', 'Everything Else', new Date('2024-01-01'), {
          isOngoing: true,
          isSystemEverythingElse: true
        })
      ];

      mockBudgetQuery(budgets);

      const transactions = [
        createTransaction(new Date('2025-01-15'), 50.00)
      ];

      const result = await matchTransactionSplitsToBudgets(transactions, mockUserId);

      expect(result[0].splits[0].budgetId).toBe('budget_everything');
      expect(result[0].splits[0].budgetName).toBe('Everything Else');
    });

    it('should assign to "Everything Else" when no regular budget matches category', async () => {
      const budgets = [
        createBudget('budget_food', 'Food Budget', new Date('2025-01-01'), {
          isOngoing: true,
          categoryIds: ['FOOD_AND_DRINK'] // Different from transaction's GENERAL_MERCHANDISE
        }),
        createBudget('budget_everything', 'Everything Else', new Date('2024-01-01'), {
          isOngoing: true,
          isSystemEverythingElse: true
        })
      ];

      mockBudgetQuery(budgets);

      const transactions = [
        createTransaction(new Date('2025-01-15'), 50.00)
      ];

      const result = await matchTransactionSplitsToBudgets(transactions, mockUserId);

      expect(result[0].splits[0].budgetId).toBe('budget_everything');
      expect(result[0].splits[0].budgetName).toBe('Everything Else');
    });

    it('should prefer regular budget over "Everything Else" when both date AND category match', async () => {
      const budgets = [
        createBudget('budget_groceries', 'Groceries', new Date('2025-01-01'), {
          isOngoing: true,
          categoryIds: ['GENERAL_MERCHANDISE']
        }),
        createBudget('budget_everything', 'Everything Else', new Date('2024-01-01'), {
          isOngoing: true,
          isSystemEverythingElse: true
        })
      ];

      mockBudgetQuery(budgets);

      const transactions = [
        createTransaction(new Date('2025-01-15'), 50.00)
      ];

      const result = await matchTransactionSplitsToBudgets(transactions, mockUserId);

      // Should match Groceries, not Everything Else
      expect(result[0].splits[0].budgetId).toBe('budget_groceries');
    });

    it('should handle multiple transactions with mixed matches', async () => {
      const budgets = [
        createBudget('budget_groceries', 'Groceries', new Date('2025-01-01'), {
          isOngoing: false,
          endDate: new Date('2025-06-30'),
          categoryIds: ['GENERAL_MERCHANDISE']
        }),
        createBudget('budget_everything', 'Everything Else', new Date('2024-01-01'), {
          isOngoing: true,
          isSystemEverythingElse: true
        })
      ];

      mockBudgetQuery(budgets);

      const transactions = [
        createTransaction(new Date('2025-03-15'), 50.00),  // Within Groceries range
        createTransaction(new Date('2025-09-15'), 75.00)   // After Groceries end
      ];

      const result = await matchTransactionSplitsToBudgets(transactions, mockUserId);

      expect(result[0].splits[0].budgetId).toBe('budget_groceries');
      expect(result[1].splits[0].budgetId).toBe('budget_everything');
    });
  });

  describe('Unassigned Scenarios', () => {
    it('should leave budgetId as "unassigned" when no budgets exist', async () => {
      mockBudgetQuery([]); // No budgets

      const transactions = [
        createTransaction(new Date('2025-01-15'), 50.00)
      ];

      const result = await matchTransactionSplitsToBudgets(transactions, mockUserId);

      expect(result[0].splits[0].budgetId).toBe('unassigned');
    });

    it('should leave budgetId as "unassigned" when no "Everything Else" exists and no match', async () => {
      const budgets = [
        createBudget('budget_future', 'Future Budget', new Date('2026-01-01'), { isOngoing: true })
        // No "Everything Else" budget
      ];

      mockBudgetQuery(budgets);

      const transactions = [
        createTransaction(new Date('2025-01-15'), 50.00)
      ];

      const result = await matchTransactionSplitsToBudgets(transactions, mockUserId);

      expect(result[0].splits[0].budgetId).toBe('unassigned');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty transaction array', async () => {
      mockBudgetQuery([]);

      const result = await matchTransactionSplitsToBudgets([], mockUserId);

      expect(result).toEqual([]);
      expect(db.collection).not.toHaveBeenCalled(); // Should early return
    });

    it('should skip budget without start date', async () => {
      const budgets = [
        {
          id: 'budget_no_start',
          data: () => ({
            name: 'No Start Date Budget',
            startDate: null, // Missing start date
            endDate: null,
            isOngoing: true,
            isSystemEverythingElse: false,
            categoryIds: ['GENERAL_MERCHANDISE']
          })
        },
        createBudget('budget_everything', 'Everything Else', new Date('2024-01-01'), {
          isOngoing: true,
          isSystemEverythingElse: true
        })
      ];

      mockBudgetQuery(budgets);

      const transactions = [
        createTransaction(new Date('2025-01-15'), 50.00)
      ];

      const result = await matchTransactionSplitsToBudgets(transactions, mockUserId);

      // Should skip budget_no_start and use Everything Else
      expect(result[0].splits[0].budgetId).toBe('budget_everything');
    });

    it('should update all splits in multi-split transaction with same category', async () => {
      const budgets = [
        createBudget('budget_test', 'Test Budget', new Date('2025-01-01'), {
          isOngoing: true,
          categoryIds: ['GENERAL_MERCHANDISE']
        })
      ];

      mockBudgetQuery(budgets);

      const multiSplitTransaction = createTransaction(new Date('2025-01-15'), 100.00);
      multiSplitTransaction.splits = [
        { ...multiSplitTransaction.splits[0], splitId: 'split_001', amount: 60.00 },
        { ...multiSplitTransaction.splits[0], splitId: 'split_002', amount: 40.00 }
      ];

      const transactions = [multiSplitTransaction];

      const result = await matchTransactionSplitsToBudgets(transactions, mockUserId);

      // Both splits should have budgetId updated (same category)
      expect(result[0].splits[0].budgetId).toBe('budget_test');
      expect(result[0].splits[1].budgetId).toBe('budget_test');
      expect(result[0].splits[0].budgetName).toBe('Test Budget');
      expect(result[0].splits[1].budgetName).toBe('Test Budget');
    });

    it('should handle Firestore query error gracefully', async () => {
      (db.collection as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockRejectedValue(new Error('Firestore error'))
      });

      const transactions = [
        createTransaction(new Date('2025-01-15'), 50.00)
      ];

      const result = await matchTransactionSplitsToBudgets(transactions, mockUserId);

      // Should return original transactions unchanged
      expect(result[0].splits[0].budgetId).toBe('unassigned');
    });

    it('should handle transaction with no category (falls back to Everything Else)', async () => {
      const budgets = [
        createBudget('budget_food', 'Food Budget', new Date('2025-01-01'), {
          isOngoing: true,
          categoryIds: ['FOOD_AND_DRINK']
        }),
        createBudget('budget_everything', 'Everything Else', new Date('2024-01-01'), {
          isOngoing: true,
          isSystemEverythingElse: true
        })
      ];

      mockBudgetQuery(budgets);

      const transaction = createTransaction(new Date('2025-01-15'), 50.00);
      // Clear category fields
      transaction.splits[0].plaidPrimaryCategory = '';
      transaction.splits[0].internalPrimaryCategory = null;

      const result = await matchTransactionSplitsToBudgets([transaction], mockUserId);

      // Should fall back to Everything Else since no category to match
      expect(result[0].splits[0].budgetId).toBe('budget_everything');
    });
  });

  describe('Split Field Preservation', () => {
    it('should preserve all 18 split fields during matching', async () => {
      const budgets = [
        createBudget('budget_test', 'Test Budget', new Date('2025-01-01'), {
          isOngoing: true,
          categoryIds: ['FOOD'] // Will match internalPrimaryCategory set below
        })
      ];

      mockBudgetQuery(budgets);

      const transaction = createTransaction(new Date('2025-01-15'), 75.50);
      const originalSplit = transaction.splits[0];

      // Set all fields to verify preservation
      originalSplit.description = 'Custom description';
      originalSplit.monthlyPeriodId = 'period_monthly_001';
      originalSplit.weeklyPeriodId = 'period_weekly_001';
      originalSplit.biWeeklyPeriodId = 'period_biweekly_001';
      originalSplit.outflowId = 'outflow_001';
      originalSplit.internalPrimaryCategory = 'FOOD';
      originalSplit.internalDetailedCategory = 'GROCERIES';
      originalSplit.isIgnored = true;
      originalSplit.isRefund = true;
      originalSplit.isTaxDeductible = true;
      originalSplit.ignoredReason = 'Test reason';
      originalSplit.refundReason = 'Returned item';
      originalSplit.tags = ['walmart', 'groceries'];
      originalSplit.rules = ['rule_001'];

      const result = await matchTransactionSplitsToBudgets([transaction], mockUserId);
      const updatedSplit = result[0].splits[0];

      // Verify all fields preserved (except budgetId, budgetName, updatedAt which should change)
      expect(updatedSplit.splitId).toBe(originalSplit.splitId);
      expect(updatedSplit.amount).toBe(originalSplit.amount);
      expect(updatedSplit.description).toBe('Custom description');
      expect(updatedSplit.isDefault).toBe(originalSplit.isDefault);
      expect(updatedSplit.monthlyPeriodId).toBe('period_monthly_001');
      expect(updatedSplit.weeklyPeriodId).toBe('period_weekly_001');
      expect(updatedSplit.biWeeklyPeriodId).toBe('period_biweekly_001');
      expect(updatedSplit.outflowId).toBe('outflow_001');
      expect(updatedSplit.plaidPrimaryCategory).toBe(originalSplit.plaidPrimaryCategory);
      expect(updatedSplit.plaidDetailedCategory).toBe(originalSplit.plaidDetailedCategory);
      expect(updatedSplit.internalPrimaryCategory).toBe('FOOD');
      expect(updatedSplit.internalDetailedCategory).toBe('GROCERIES');
      expect(updatedSplit.isIgnored).toBe(true);
      expect(updatedSplit.isRefund).toBe(true);
      expect(updatedSplit.isTaxDeductible).toBe(true);
      expect(updatedSplit.ignoredReason).toBe('Test reason');
      expect(updatedSplit.refundReason).toBe('Returned item');
      expect(updatedSplit.paymentDate).toBe(originalSplit.paymentDate);
      expect(updatedSplit.rules).toEqual(['rule_001']);
      expect(updatedSplit.tags).toEqual(['walmart', 'groceries']);
      expect(updatedSplit.createdAt).toBe(originalSplit.createdAt);

      // These should be updated
      expect(updatedSplit.budgetId).toBe('budget_test');
      expect(updatedSplit.budgetName).toBe('Test Budget');
      expect(updatedSplit.updatedAt).toBeDefined();
      expect(updatedSplit.updatedAt).not.toBe(originalSplit.updatedAt);
    });
  });

  describe('Performance & Scalability', () => {
    it('should handle 100 transactions efficiently', async () => {
      const budgets = [
        createBudget('budget_test', 'Test Budget', new Date('2025-01-01'), {
          isOngoing: true,
          categoryIds: ['GENERAL_MERCHANDISE']
        })
      ];

      mockBudgetQuery(budgets);

      // Generate 100 transactions
      const transactions = Array.from({ length: 100 }, (_, i) =>
        createTransaction(new Date('2025-01-15'), 50.00 + i)
      );

      const startTime = Date.now();
      const result = await matchTransactionSplitsToBudgets(transactions, mockUserId);
      const duration = Date.now() - startTime;

      expect(result).toHaveLength(100);
      expect(result.every(t => t.splits[0].budgetId === 'budget_test')).toBe(true);

      // Should complete in under 100ms (in-memory operation)
      expect(duration).toBeLessThan(100);
    });

    it('should handle 20 budgets efficiently', async () => {
      // Create 20 budgets with different categories
      const budgets = Array.from({ length: 20 }, (_, i) =>
        createBudget(
          `budget_${i}`,
          `Budget ${i}`,
          new Date(`2025-0${Math.floor(i / 2) + 1}-01`),
          {
            isOngoing: true,
            categoryIds: i === 0 ? ['GENERAL_MERCHANDISE'] : [`CATEGORY_${i}`]
          }
        )
      );

      mockBudgetQuery(budgets);

      const transactions = [
        createTransaction(new Date('2025-01-15'), 50.00)
      ];

      const result = await matchTransactionSplitsToBudgets(transactions, mockUserId);

      // First budget with matching category
      expect(result[0].splits[0].budgetId).toBe('budget_0');
    });
  });

  describe('Logging & Observability', () => {
    it('should log budget query results', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const budgets = [
        createBudget('budget_test', 'Test Budget', new Date('2025-01-01'), {
          isOngoing: true,
          categoryIds: ['GENERAL_MERCHANDISE']
        })
      ];

      mockBudgetQuery(budgets);

      await matchTransactionSplitsToBudgets([createTransaction(new Date('2025-01-15'), 50)], mockUserId);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found 1 active budgets for user')
      );

      consoleSpy.mockRestore();
    });

    it('should log "Everything Else" fallback assignment', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const budgets = [
        createBudget('budget_future', 'Future Budget', new Date('2026-01-01'), {
          isOngoing: true,
          categoryIds: ['GENERAL_MERCHANDISE']
        }),
        createBudget('budget_everything', 'Everything Else', new Date('2024-01-01'), {
          isOngoing: true,
          isSystemEverythingElse: true
        })
      ];

      mockBudgetQuery(budgets);

      await matchTransactionSplitsToBudgets([createTransaction(new Date('2025-01-15'), 50)], mockUserId);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Split assigned to "Everything Else" budget')
      );

      consoleSpy.mockRestore();
    });

    it('should warn when no budget match found', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      mockBudgetQuery([]); // No budgets

      await matchTransactionSplitsToBudgets([createTransaction(new Date('2025-01-15'), 50)], mockUserId);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Split has no matching budget')
      );

      consoleWarnSpy.mockRestore();
    });

    it('should log category matching success', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const budgets = [
        createBudget('budget_test', 'Test Budget', new Date('2025-01-01'), {
          isOngoing: true,
          categoryIds: ['GENERAL_MERCHANDISE']
        })
      ];

      mockBudgetQuery(budgets);

      await matchTransactionSplitsToBudgets([createTransaction(new Date('2025-01-15'), 50)], mockUserId);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Split matched to "Test Budget" (date + category')
      );

      consoleSpy.mockRestore();
    });
  });
});
