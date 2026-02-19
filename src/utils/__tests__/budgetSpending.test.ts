/**
 * Comprehensive Tests for Budget Spending Calculations
 *
 * Tests the critical budget spending update logic that maintains accurate
 * budget_period.spent amounts when transactions are created, updated, or deleted.
 *
 * This is a keystone component ensuring financial data accuracy.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { updateBudgetSpending } from '../budgetSpending';
import { Transaction, TransactionStatus, TransactionType, PeriodType } from '../../types';

// Mock Firestore
jest.mock('../../index', () => ({
  db: {
    collection: jest.fn()
  }
}));

import { db } from '../../index';

describe('Budget Spending Calculations', () => {
  const mockUserId = 'user_test_001';
  const mockBudgetId = 'budget_groceries_001';

  // Helper to create realistic transaction
  const createTransaction = (
    amount: number,
    budgetId: string,
    date: Date,
    overrides?: Partial<Transaction>
  ): Transaction => {
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
          budgetId,
          budgetName: 'Groceries',
          amount,
          description: null,
          isDefault: true,
          monthlyPeriodId: 'period_monthly_2025_01',
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

  // Helper to create budget period
  const createBudgetPeriod = (
    periodId: string,
    periodType: PeriodType,
    startDate: Date,
    endDate: Date,
    allocated: number,
    budgetId: string,
    spent: number = 0
  ) => ({
    id: `bp_${periodId}`,
    data: () => ({
      periodId,
      periodType,
      budgetId,
      userId: mockUserId,
      budgetName: 'Groceries',
      startDate: Timestamp.fromDate(startDate),
      endDate: Timestamp.fromDate(endDate),
      allocatedAmount: allocated,
      modifiedAmount: undefined,
      spent,
      remaining: allocated - spent,
      isActive: true
    }),
    ref: {
      update: jest.fn()
    }
  });

  // Mock batch for Firestore
  const createMockBatch = () => {
    const updates: any[] = [];
    return {
      update: jest.fn((ref, data) => {
        updates.push({ ref, data });
      }),
      commit: jest.fn().mockResolvedValue(undefined),
      _updates: updates
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('updateBudgetSpending - Transaction Creation', () => {
    it('should add spending when new transaction created', async () => {
      const newTransaction = createTransaction(
        75.00,
        mockBudgetId,
        new Date('2025-01-15')
      );

      const mockPeriods = [
        createBudgetPeriod(
          '2025-M01',
          PeriodType.MONTHLY,
          new Date('2025-01-01'),
          new Date('2025-01-31'),
          500.00,
          mockBudgetId,
          0 // No spending yet
        )
      ];

      const mockBatch = createMockBatch();

      (db.collection as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          empty: false,
          size: 1,
          docs: mockPeriods,
          forEach: (callback: any) => mockPeriods.forEach(callback)
        })
      });

      (db as any).batch = jest.fn().mockReturnValue(mockBatch);

      const result = await updateBudgetSpending({
        newTransaction,
        userId: mockUserId
      });

      expect(result.budgetPeriodsUpdated).toBe(1);
      expect(result.budgetsAffected).toContain(mockBudgetId);
      expect(mockBatch.update).toHaveBeenCalledWith(
        mockPeriods[0].ref,
        expect.objectContaining({
          spent: 75.00,
          remaining: 425.00
        })
      );
    });

    it('should update multiple period types simultaneously', async () => {
      const newTransaction = createTransaction(
        50.00,
        mockBudgetId,
        new Date('2025-01-15')
      );

      const mockPeriods = [
        createBudgetPeriod('2025-M01', PeriodType.MONTHLY, new Date('2025-01-01'), new Date('2025-01-31'), 500.00, mockBudgetId),
        createBudgetPeriod('2025-BM01-1', PeriodType.BI_MONTHLY, new Date('2025-01-01'), new Date('2025-01-15'), 250.00, mockBudgetId),
        createBudgetPeriod('2025-W03', PeriodType.WEEKLY, new Date('2025-01-13'), new Date('2025-01-19'), 114.90, mockBudgetId)
      ];

      const mockBatch = createMockBatch();

      (db.collection as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          empty: false,
          size: 3,
          docs: mockPeriods,
          forEach: (callback: any) => mockPeriods.forEach(callback)
        })
      });

      (db as any).batch = jest.fn().mockReturnValue(mockBatch);

      const result = await updateBudgetSpending({
        newTransaction,
        userId: mockUserId
      });

      expect(result.budgetPeriodsUpdated).toBe(3);
      expect(result.periodTypesUpdated.monthly).toBe(1);
      expect(result.periodTypesUpdated.bi_monthly).toBe(1);
      expect(result.periodTypesUpdated.weekly).toBe(1);
    });

    it('should skip periods outside transaction date range', async () => {
      const newTransaction = createTransaction(
        50.00,
        mockBudgetId,
        new Date('2025-01-15')
      );

      const mockPeriods = [
        createBudgetPeriod('2025-M01', PeriodType.MONTHLY, new Date('2025-01-01'), new Date('2025-01-31'), 500.00, mockBudgetId),
        createBudgetPeriod('2025-M02', PeriodType.MONTHLY, new Date('2025-02-01'), new Date('2025-02-28'), 500.00, mockBudgetId) // Outside range
      ];

      const mockBatch = createMockBatch();

      (db.collection as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          empty: false,
          size: 2,
          docs: mockPeriods,
          forEach: (callback: any) => mockPeriods.forEach(callback)
        })
      });

      (db as any).batch = jest.fn().mockReturnValue(mockBatch);

      const result = await updateBudgetSpending({
        newTransaction,
        userId: mockUserId
      });

      // Should only update January period
      expect(result.budgetPeriodsUpdated).toBe(1);
      expect(mockBatch.update).toHaveBeenCalledTimes(1);
    });

    it('should handle transaction on period boundary dates', async () => {
      // Transaction on period start date
      const startDateTxn = createTransaction(
        30.00,
        mockBudgetId,
        new Date('2025-01-01')
      );

      // Transaction on period end date
      const endDateTxn = createTransaction(
        40.00,
        mockBudgetId,
        new Date('2025-01-31')
      );

      const mockPeriods = [
        createBudgetPeriod('2025-M01', PeriodType.MONTHLY, new Date('2025-01-01'), new Date('2025-01-31'), 500.00, mockBudgetId)
      ];

      const mockBatch = createMockBatch();

      (db.collection as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          empty: false,
          size: 1,
          docs: mockPeriods,
          forEach: (callback: any) => mockPeriods.forEach(callback)
        })
      });

      (db as any).batch = jest.fn().mockReturnValue(mockBatch);

      // Test start date
      const startResult = await updateBudgetSpending({
        newTransaction: startDateTxn,
        userId: mockUserId
      });

      expect(startResult.budgetPeriodsUpdated).toBe(1);

      jest.clearAllMocks();
      (db as any).batch = jest.fn().mockReturnValue(mockBatch);
      (db.collection as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          empty: false,
          size: 1,
          docs: mockPeriods,
          forEach: (callback: any) => mockPeriods.forEach(callback)
        })
      });

      // Test end date
      const endResult = await updateBudgetSpending({
        newTransaction: endDateTxn,
        userId: mockUserId
      });

      expect(endResult.budgetPeriodsUpdated).toBe(1);
    });
  });

  describe('updateBudgetSpending - Transaction Updates', () => {
    it('should calculate positive delta when amount increased', async () => {
      const oldTransaction = createTransaction(
        50.00,
        mockBudgetId,
        new Date('2025-01-15')
      );

      const newTransaction = createTransaction(
        75.00,
        mockBudgetId,
        new Date('2025-01-15')
      );

      const mockPeriods = [
        createBudgetPeriod('2025-M01', PeriodType.MONTHLY, new Date('2025-01-01'), new Date('2025-01-31'), 500.00, mockBudgetId, 50.00)
      ];

      const mockBatch = createMockBatch();

      (db.collection as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          empty: false,
          size: 1,
          docs: mockPeriods,
          forEach: (callback: any) => mockPeriods.forEach(callback)
        })
      });

      (db as any).batch = jest.fn().mockReturnValue(mockBatch);

      const result = await updateBudgetSpending({
        oldTransaction,
        newTransaction,
        userId: mockUserId
      });

      expect(result.budgetPeriodsUpdated).toBe(1);
      expect(mockBatch.update).toHaveBeenCalledWith(
        mockPeriods[0].ref,
        expect.objectContaining({
          spent: 75.00, // 50 + delta(25)
          remaining: 425.00 // 500 - 75
        })
      );
    });

    it('should calculate negative delta when amount decreased', async () => {
      const oldTransaction = createTransaction(
        100.00,
        mockBudgetId,
        new Date('2025-01-15')
      );

      const newTransaction = createTransaction(
        60.00,
        mockBudgetId,
        new Date('2025-01-15')
      );

      const mockPeriods = [
        createBudgetPeriod('2025-M01', PeriodType.MONTHLY, new Date('2025-01-01'), new Date('2025-01-31'), 500.00, mockBudgetId, 100.00)
      ];

      const mockBatch = createMockBatch();

      (db.collection as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          empty: false,
          size: 1,
          docs: mockPeriods,
          forEach: (callback: any) => mockPeriods.forEach(callback)
        })
      });

      (db as any).batch = jest.fn().mockReturnValue(mockBatch);

      const result = await updateBudgetSpending({
        oldTransaction,
        newTransaction,
        userId: mockUserId
      });

      expect(result.budgetPeriodsUpdated).toBe(1);
      expect(mockBatch.update).toHaveBeenCalledWith(
        mockPeriods[0].ref,
        expect.objectContaining({
          spent: 60.00, // 100 + delta(-40)
          remaining: 440.00
        })
      );
    });

    it('should handle budget reassignment (different budgets)', async () => {
      const oldBudgetId = 'budget_groceries';
      const newBudgetId = 'budget_dining';

      const oldTransaction = createTransaction(
        50.00,
        oldBudgetId,
        new Date('2025-01-15')
      );

      const newTransaction = createTransaction(
        50.00,
        newBudgetId,
        new Date('2025-01-15')
      );

      const mockGroceriesPeriods = [
        createBudgetPeriod('2025-M01-groceries', PeriodType.MONTHLY, new Date('2025-01-01'), new Date('2025-01-31'), 500.00, oldBudgetId, 50.00)
      ];

      const mockDiningPeriods = [
        createBudgetPeriod('2025-M01-dining', PeriodType.MONTHLY, new Date('2025-01-01'), new Date('2025-01-31'), 200.00, newBudgetId, 0)
      ];

      const mockBatch = createMockBatch();

      // Mock different responses based on budgetId
      (db.collection as jest.Mock).mockReturnValue({
        where: jest.fn(function(this: any, field: string, op: string, value: any) {
          if (field === 'budgetId') {
            this._budgetId = value;
          }
          return this;
        }),
        get: jest.fn(function(this: any) {
          const budgetId = this._budgetId;
          if (budgetId === oldBudgetId) {
            return Promise.resolve({
              empty: false,
              size: 1,
              docs: mockGroceriesPeriods,
              forEach: (callback: any) => mockGroceriesPeriods.forEach(callback)
            });
          } else if (budgetId === newBudgetId) {
            return Promise.resolve({
              empty: false,
              size: 1,
              docs: mockDiningPeriods,
              forEach: (callback: any) => mockDiningPeriods.forEach(callback)
            });
          }
          return Promise.resolve({ empty: true, size: 0, docs: [], forEach: () => {} });
        })
      });

      (db as any).batch = jest.fn().mockReturnValue(mockBatch);

      const result = await updateBudgetSpending({
        oldTransaction,
        newTransaction,
        userId: mockUserId
      });

      expect(result.budgetsAffected).toHaveLength(2);
      expect(result.budgetsAffected).toContain(oldBudgetId);
      expect(result.budgetsAffected).toContain(newBudgetId);
      expect(mockBatch.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateBudgetSpending - Transaction Deletion', () => {
    it('should reverse spending when transaction deleted', async () => {
      const oldTransaction = createTransaction(
        85.00,
        mockBudgetId,
        new Date('2025-01-15')
      );

      const mockPeriods = [
        createBudgetPeriod('2025-M01', PeriodType.MONTHLY, new Date('2025-01-01'), new Date('2025-01-31'), 500.00, mockBudgetId, 85.00)
      ];

      const mockBatch = createMockBatch();

      (db.collection as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          empty: false,
          size: 1,
          docs: mockPeriods,
          forEach: (callback: any) => mockPeriods.forEach(callback)
        })
      });

      (db as any).batch = jest.fn().mockReturnValue(mockBatch);

      const result = await updateBudgetSpending({
        oldTransaction,
        newTransaction: undefined, // Deletion
        userId: mockUserId
      });

      expect(result.budgetPeriodsUpdated).toBe(1);
      expect(mockBatch.update).toHaveBeenCalledWith(
        mockPeriods[0].ref,
        expect.objectContaining({
          spent: 0.00, // 85 + delta(-85)
          remaining: 500.00
        })
      );
    });
  });

  describe('updateBudgetSpending - Transaction Status Filtering', () => {
    it('should only count APPROVED transactions', async () => {
      const pendingTransaction = createTransaction(
        50.00,
        mockBudgetId,
        new Date('2025-01-15'),
        { transactionStatus: TransactionStatus.PENDING }
      );

      const result = await updateBudgetSpending({
        newTransaction: pendingTransaction,
        userId: mockUserId
      });

      // Should not update any periods
      expect(result.budgetPeriodsUpdated).toBe(0);
      expect(result.budgetsAffected).toHaveLength(0);
    });

    it('should only count EXPENSE transactions', async () => {
      const incomeTransaction = createTransaction(
        500.00,
        mockBudgetId,
        new Date('2025-01-15'),
        { type: TransactionType.INCOME }
      );

      const result = await updateBudgetSpending({
        newTransaction: incomeTransaction,
        userId: mockUserId
      });

      // Should not update any periods
      expect(result.budgetPeriodsUpdated).toBe(0);
      expect(result.budgetsAffected).toHaveLength(0);
    });

    it('should update when transaction status changes from PENDING to APPROVED', async () => {
      const oldTransaction = createTransaction(
        75.00,
        mockBudgetId,
        new Date('2025-01-15'),
        { transactionStatus: TransactionStatus.PENDING }
      );

      const newTransaction = createTransaction(
        75.00,
        mockBudgetId,
        new Date('2025-01-15'),
        { transactionStatus: TransactionStatus.APPROVED }
      );

      const mockPeriods = [
        createBudgetPeriod('2025-M01', PeriodType.MONTHLY, new Date('2025-01-01'), new Date('2025-01-31'), 500.00, mockBudgetId, 0)
      ];

      const mockBatch = createMockBatch();

      (db.collection as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          empty: false,
          size: 1,
          docs: mockPeriods,
          forEach: (callback: any) => mockPeriods.forEach(callback)
        })
      });

      (db as any).batch = jest.fn().mockReturnValue(mockBatch);

      const result = await updateBudgetSpending({
        oldTransaction, // Was pending (not counted)
        newTransaction, // Now approved (counts)
        userId: mockUserId
      });

      expect(result.budgetPeriodsUpdated).toBe(1);
      expect(mockBatch.update).toHaveBeenCalledWith(
        mockPeriods[0].ref,
        expect.objectContaining({
          spent: 75.00, // Delta: 0 → 75
          remaining: 425.00
        })
      );
    });
  });

  describe('updateBudgetSpending - Multi-Split Transactions', () => {
    it('should handle transactions with multiple splits across different budgets', async () => {
      const multiSplitTransaction = createTransaction(
        100.00,
        'budget_groceries',
        new Date('2025-01-15')
      );

      // Override splits with multiple budgets
      multiSplitTransaction.splits = [
        {
          ...multiSplitTransaction.splits[0],
          splitId: 'split_001',
          budgetId: 'budget_groceries',
          amount: 60.00
        },
        {
          ...multiSplitTransaction.splits[0],
          splitId: 'split_002',
          budgetId: 'budget_household',
          amount: 40.00
        }
      ];

      const mockGroceriesPeriods = [
        createBudgetPeriod('2025-M01-groceries', PeriodType.MONTHLY, new Date('2025-01-01'), new Date('2025-01-31'), 500.00, 'budget_groceries', 0)
      ];

      const mockHouseholdPeriods = [
        createBudgetPeriod('2025-M01-household', PeriodType.MONTHLY, new Date('2025-01-01'), new Date('2025-01-31'), 200.00, 'budget_household', 0)
      ];

      const mockBatch = createMockBatch();

      // Mock to handle multiple where clauses and track budgetId
      (db.collection as jest.Mock).mockReturnValue({
        where: jest.fn(function(this: any, field: string, op: string, value: any) {
          if (field === 'budgetId') {
            this._budgetId = value;
          }
          return this;
        }),
        get: jest.fn(function(this: any) {
          const budgetId = this._budgetId;
          if (budgetId === 'budget_groceries') {
            return Promise.resolve({
              empty: false,
              size: 1,
              docs: mockGroceriesPeriods,
              forEach: (callback: any) => mockGroceriesPeriods.forEach(callback)
            });
          } else if (budgetId === 'budget_household') {
            return Promise.resolve({
              empty: false,
              size: 1,
              docs: mockHouseholdPeriods,
              forEach: (callback: any) => mockHouseholdPeriods.forEach(callback)
            });
          }
          return Promise.resolve({ empty: true, size: 0, docs: [], forEach: () => {} });
        })
      });

      (db as any).batch = jest.fn().mockReturnValue(mockBatch);

      const result = await updateBudgetSpending({
        newTransaction: multiSplitTransaction,
        userId: mockUserId
      });

      expect(result.budgetsAffected).toHaveLength(2);
      expect(result.budgetsAffected).toContain('budget_groceries');
      expect(result.budgetsAffected).toContain('budget_household');
      expect(mockBatch.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateBudgetSpending - Edge Cases', () => {
    it('should skip unassigned budget', async () => {
      const unassignedTransaction = createTransaction(
        50.00,
        'unassigned',
        new Date('2025-01-15')
      );

      const result = await updateBudgetSpending({
        newTransaction: unassignedTransaction,
        userId: mockUserId
      });

      expect(result.budgetPeriodsUpdated).toBe(0);
      expect(result.budgetsAffected).toHaveLength(0);
    });

    it('should handle missing transaction date gracefully', async () => {
      const transactionWithoutDate = createTransaction(
        50.00,
        mockBudgetId,
        new Date('2025-01-15')
      );

      // Remove transaction date
      (transactionWithoutDate as any).transactionDate = undefined;

      const result = await updateBudgetSpending({
        newTransaction: transactionWithoutDate,
        userId: mockUserId
      });

      expect(result.budgetPeriodsUpdated).toBe(0);
      expect(result.errors).toHaveLength(0); // Graceful handling, not an error
    });

    it('should handle no budget periods gracefully', async () => {
      const transaction = createTransaction(
        50.00,
        mockBudgetId,
        new Date('2025-01-15')
      );

      (db.collection as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          empty: true,
          size: 0,
          docs: [],
          forEach: () => {}
        })
      });

      const result = await updateBudgetSpending({
        newTransaction: transaction,
        userId: mockUserId
      });

      expect(result.budgetPeriodsUpdated).toBe(0);
      expect(result.budgetsAffected).toHaveLength(0);
    });

    it('should use modifiedAmount over allocatedAmount when available', async () => {
      const transaction = createTransaction(
        60.00,
        mockBudgetId,
        new Date('2025-01-15')
      );

      // Create period with modifiedAmount set
      const periodWithModifiedAmount = {
        id: 'bp_2025-M01',
        data: () => ({
          periodId: '2025-M01',
          periodType: PeriodType.MONTHLY,
          budgetId: mockBudgetId,
          userId: mockUserId,
          budgetName: 'Groceries',
          startDate: Timestamp.fromDate(new Date('2025-01-01')),
          endDate: Timestamp.fromDate(new Date('2025-01-31')),
          allocatedAmount: 500.00,
          modifiedAmount: 600.00, // User increased budget
          spent: 0,
          remaining: 600.00, // Based on modifiedAmount
          isActive: true
        }),
        ref: {
          update: jest.fn()
        }
      };

      const mockBatch = createMockBatch();

      (db.collection as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          empty: false,
          size: 1,
          docs: [periodWithModifiedAmount],
          forEach: (callback: any) => [periodWithModifiedAmount].forEach(callback)
        })
      });

      (db as any).batch = jest.fn().mockReturnValue(mockBatch);

      await updateBudgetSpending({
        newTransaction: transaction,
        userId: mockUserId
      });

      expect(mockBatch.update).toHaveBeenCalledWith(
        periodWithModifiedAmount.ref,
        expect.objectContaining({
          spent: 60.00,
          remaining: 540.00 // 600 (modified) - 60 (spent)
        })
      );
    });
  });

  describe('updateBudgetSpending - Error Handling', () => {
    it('should handle individual budget update failures', async () => {
      const transaction = createTransaction(
        50.00,
        mockBudgetId,
        new Date('2025-01-15')
      );

      (db.collection as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockRejectedValue(new Error('Firestore error'))
      });

      const result = await updateBudgetSpending({
        newTransaction: transaction,
        userId: mockUserId
      });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Failed to update budget');
    });

    it('should continue processing other budgets if one fails', async () => {
      const multiSplitTransaction = createTransaction(
        100.00,
        'budget_groceries',
        new Date('2025-01-15')
      );

      multiSplitTransaction.splits = [
        { ...multiSplitTransaction.splits[0], budgetId: 'budget_groceries', amount: 60 },
        { ...multiSplitTransaction.splits[0], budgetId: 'budget_household', amount: 40 }
      ];

      let callCount = 0;
      (db.collection as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        get: jest.fn(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.reject(new Error('First budget failed'));
          }
          return Promise.resolve({
            empty: false,
            size: 1,
            docs: [createBudgetPeriod('2025-M01', PeriodType.MONTHLY, new Date('2025-01-01'), new Date('2025-01-31'), 200, 'budget_household', 0)],
            forEach: (callback: any) => [createBudgetPeriod('2025-M01', PeriodType.MONTHLY, new Date('2025-01-01'), new Date('2025-01-31'), 200, 'budget_household', 0)].forEach(callback)
          });
        })
      });

      const mockBatch = createMockBatch();
      (db as any).batch = jest.fn().mockReturnValue(mockBatch);

      const result = await updateBudgetSpending({
        newTransaction: multiSplitTransaction,
        userId: mockUserId
      });

      expect(result.errors).toHaveLength(1);
      expect(result.budgetsAffected).toHaveLength(1); // Second budget succeeded
    });
  });

  describe('updateBudgetSpending - Performance', () => {
    it('should handle 10 periods efficiently', async () => {
      const transaction = createTransaction(
        50.00,
        mockBudgetId,
        new Date('2025-01-15')
      );

      // Create 10 budget periods
      const mockPeriods = Array.from({ length: 10 }, (_, i) =>
        createBudgetPeriod(
          `2025-M${String(i + 1).padStart(2, '0')}`,
          PeriodType.MONTHLY,
          new Date(`2025-${String(i + 1).padStart(2, '0')}-01`),
          new Date(`2025-${String(i + 1).padStart(2, '0')}-28`),
          500.00,
          mockBudgetId
        )
      );

      const mockBatch = createMockBatch();

      (db.collection as jest.Mock).mockReturnValue({
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          empty: false,
          size: 10,
          docs: mockPeriods,
          forEach: (callback: any) => mockPeriods.forEach(callback)
        })
      });

      (db as any).batch = jest.fn().mockReturnValue(mockBatch);

      const startTime = Date.now();
      const result = await updateBudgetSpending({
        newTransaction: transaction,
        userId: mockUserId
      });
      const duration = Date.now() - startTime;

      expect(result.budgetPeriodsUpdated).toBe(1); // Only Jan 15 matches
      expect(duration).toBeLessThan(100); // Should be fast
    });
  });
});
