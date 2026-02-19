/**
 * Unit Tests for alignTransactionsToInflowPeriods
 *
 * Tests the transaction-to-period matching logic for income streams.
 * This is the core function that:
 * 1. Fetches transactions by Plaid transaction IDs
 * 2. Matches transactions to the correct inflow_period documents
 * 3. Updates occurrence tracking arrays
 * 4. Recalculates period totals
 *
 * Test scenarios:
 * - Single transaction matching
 * - Multiple transactions across periods
 * - All three period types (weekly, bi-weekly, monthly)
 * - Occurrence matching within periods
 * - Edge cases (missing transactions, inactive periods)
 *
 * NOTE: This test file is created BEFORE implementation (Test-First Development)
 */

import { Timestamp } from 'firebase-admin/firestore';
import {
  Inflow,
  InflowPeriod,
  PlaidRecurringFrequency
} from '../../../../types';

// Import the actual implementation
import { alignTransactionsToInflowPeriods } from '../utils/alignTransactionsToInflowPeriods';

// Test-specific transaction mock type (includes amount at root like Plaid data)
interface MockTransaction {
  id: string;
  transactionId: string;
  transactionDate: Timestamp;
  amount: number;
  ownerId: string;
  description: string;
  splits: Array<{ splitId: string; amount: number; budgetId: string; isDefault: boolean }>;
}

describe('alignTransactionsToInflowPeriods', () => {
  // Mock Firestore
  let mockDb: any;
  let mockTransactions: Map<string, MockTransaction>;
  let mockInflowPeriods: Map<string, Partial<InflowPeriod>>;

  beforeEach(() => {
    mockTransactions = new Map();
    mockInflowPeriods = new Map();

    // Create a mock batch that tracks updates
    const createMockBatch = () => ({
      update: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined)
    });

    mockDb = {
      collection: jest.fn((name: string) => ({
        doc: jest.fn((id: string) => ({
          get: jest.fn(async () => {
            if (name === 'transactions') {
              const txn = mockTransactions.get(id);
              return { exists: !!txn, data: () => txn, id };
            }
            if (name === 'inflow_periods') {
              const period = mockInflowPeriods.get(id);
              return { exists: !!period, data: () => period, id };
            }
            return { exists: false };
          }),
          update: jest.fn()
        })),
        where: jest.fn(() => ({
          where: jest.fn(() => ({
            where: jest.fn(() => ({
              limit: jest.fn(() => ({
                get: jest.fn(async () => ({
                  empty: true,
                  docs: []
                }))
              }))
            }))
          })),
          get: jest.fn(async () => ({
            docs: Array.from(mockInflowPeriods.entries()).map(([id, data]) => ({
              id,
              data: () => data
            }))
          }))
        }))
      })),
      batch: jest.fn(createMockBatch),
      getAll: jest.fn()
    };
  });

  // Helper to create mock transaction
  const createMockTransaction = (
    id: string,
    date: Date,
    amount: number,
    userId: string = 'user_123'
  ): MockTransaction => ({
    id,
    transactionId: id,
    transactionDate: Timestamp.fromDate(date),
    amount: -Math.abs(amount), // Plaid inflows are negative
    ownerId: userId,
    description: `Income Transaction ${id}`,
    splits: [{
      splitId: `split_${id}`,
      amount: Math.abs(amount),
      budgetId: 'unassigned',
      isDefault: true
    }]
  });

  // Helper to create mock inflow period
  const createMockInflowPeriod = (
    id: string,
    inflowId: string,
    periodType: string,
    startDate: Date,
    endDate: Date,
    occurrenceCount: number = 1
  ): Partial<InflowPeriod> => ({
    id,
    inflowId,
    ownerId: 'user_123',
    periodType: periodType as any,
    periodStartDate: Timestamp.fromDate(startDate),
    periodEndDate: Timestamp.fromDate(endDate),
    numberOfOccurrencesInPeriod: occurrenceCount,
    numberOfOccurrencesPaid: 0,
    numberOfOccurrencesUnpaid: occurrenceCount,
    occurrenceDueDates: [Timestamp.fromDate(new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000))],
    occurrencePaidFlags: new Array(occurrenceCount).fill(false),
    occurrenceTransactionIds: new Array(occurrenceCount).fill(null),
    occurrenceAmounts: new Array(occurrenceCount).fill(0),
    transactionIds: [],
    totalAmountDue: 2000 * occurrenceCount,
    totalAmountPaid: 0,
    totalAmountUnpaid: 2000 * occurrenceCount,
    isFullyPaid: false,
    isPartiallyPaid: false,
    isActive: true
  });

  // Helper to create mock inflow
  const createMockInflow = (
    id: string,
    transactionIds: string[],
    frequency: PlaidRecurringFrequency = PlaidRecurringFrequency.BIWEEKLY
  ): Partial<Inflow> => ({
    id,
    ownerId: 'user_123',
    frequency,
    transactionIds,
    averageAmount: 2000,
    isActive: true
  });

  // ============================================================================
  // BASIC MATCHING TESTS
  // ============================================================================

  describe('Basic transaction matching', () => {
    it('should match a single transaction to the correct monthly period', async () => {
      const transactionDate = new Date('2025-01-15');
      const txnId = 'txn_001';

      // Setup mock transaction
      mockTransactions.set(txnId, createMockTransaction(txnId, transactionDate, 2000));

      // Setup mock monthly period (Jan 2025)
      const periodId = 'inflow_001_2025-M01';
      mockInflowPeriods.set(periodId, createMockInflowPeriod(
        periodId,
        'inflow_001',
        'monthly',
        new Date('2025-01-01'),
        new Date('2025-01-31')
      ));

      const inflow = createMockInflow('inflow_001', [txnId]);

      const result = await alignTransactionsToInflowPeriods(
        mockDb,
        'inflow_001',
        inflow,
        [periodId]
      );

      expect(result.transactionsProcessed).toBe(1);
      expect(result.transactionsMatched).toBe(1);
      expect(result.periodsUpdated).toBeGreaterThanOrEqual(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should match transaction to all three period types simultaneously', async () => {
      const transactionDate = new Date('2025-01-15');
      const txnId = 'txn_002';

      mockTransactions.set(txnId, createMockTransaction(txnId, transactionDate, 2000));

      // Setup all three period types
      const monthlyPeriodId = 'inflow_001_2025-M01';
      const weeklyPeriodId = 'inflow_001_2025-W03'; // Week containing Jan 15
      const biweeklyPeriodId = 'inflow_001_2025-BM01-A';

      mockInflowPeriods.set(monthlyPeriodId, createMockInflowPeriod(
        monthlyPeriodId, 'inflow_001', 'monthly',
        new Date('2025-01-01'), new Date('2025-01-31')
      ));
      mockInflowPeriods.set(weeklyPeriodId, createMockInflowPeriod(
        weeklyPeriodId, 'inflow_001', 'weekly',
        new Date('2025-01-12'), new Date('2025-01-18')
      ));
      mockInflowPeriods.set(biweeklyPeriodId, createMockInflowPeriod(
        biweeklyPeriodId, 'inflow_001', 'bi_monthly',
        new Date('2025-01-01'), new Date('2025-01-15')
      ));

      const inflow = createMockInflow('inflow_001', [txnId]);

      const result = await alignTransactionsToInflowPeriods(
        mockDb,
        'inflow_001',
        inflow,
        [monthlyPeriodId, weeklyPeriodId, biweeklyPeriodId]
      );

      // Should update all three period types
      expect(result.periodsUpdated).toBe(3);
    });

    it('should handle multiple transactions for the same inflow', async () => {
      const txnIds = ['txn_003', 'txn_004', 'txn_005'];
      const dates = [
        new Date('2025-01-03'),
        new Date('2025-01-17'),
        new Date('2025-01-31')
      ];

      txnIds.forEach((id, idx) => {
        mockTransactions.set(id, createMockTransaction(id, dates[idx], 2000));
      });

      const periodId = 'inflow_001_2025-M01';
      mockInflowPeriods.set(periodId, createMockInflowPeriod(
        periodId, 'inflow_001', 'monthly',
        new Date('2025-01-01'), new Date('2025-01-31'),
        3 // 3 occurrences expected
      ));

      const inflow = createMockInflow('inflow_001', txnIds);

      const result = await alignTransactionsToInflowPeriods(
        mockDb,
        'inflow_001',
        inflow,
        [periodId]
      );

      expect(result.transactionsProcessed).toBe(3);
      expect(result.transactionsMatched).toBe(3);
    });
  });

  // ============================================================================
  // OCCURRENCE TRACKING TESTS
  // ============================================================================

  describe('Occurrence tracking', () => {
    it('should update occurrencePaidFlags when transaction matches', async () => {
      const txnId = 'txn_006';
      mockTransactions.set(txnId, createMockTransaction(txnId, new Date('2025-01-10'), 2000));

      const periodId = 'inflow_001_2025-M01';
      const period = createMockInflowPeriod(
        periodId, 'inflow_001', 'monthly',
        new Date('2025-01-01'), new Date('2025-01-31'),
        2 // Two occurrences
      );
      period.occurrenceDueDates = [
        Timestamp.fromDate(new Date('2025-01-10')),
        Timestamp.fromDate(new Date('2025-01-24'))
      ];
      mockInflowPeriods.set(periodId, period);

      const inflow = createMockInflow('inflow_001', [txnId]);

      await alignTransactionsToInflowPeriods(mockDb, 'inflow_001', inflow, [periodId]);

      // Verify update was called with correct occurrence tracking
      const updateCall = mockDb.collection('inflow_periods').doc(periodId).update;
      expect(updateCall).toHaveBeenCalled();

      const updateArg = updateCall.mock.calls[0][0];
      expect(updateArg.occurrencePaidFlags[0]).toBe(true);
      expect(updateArg.occurrencePaidFlags[1]).toBe(false);
    });

    it('should update occurrenceTransactionIds array', async () => {
      const txnId = 'txn_007';
      mockTransactions.set(txnId, createMockTransaction(txnId, new Date('2025-01-10'), 2000));

      const periodId = 'inflow_001_2025-M01';
      mockInflowPeriods.set(periodId, createMockInflowPeriod(
        periodId, 'inflow_001', 'monthly',
        new Date('2025-01-01'), new Date('2025-01-31')
      ));

      const inflow = createMockInflow('inflow_001', [txnId]);

      await alignTransactionsToInflowPeriods(mockDb, 'inflow_001', inflow, [periodId]);

      const updateCall = mockDb.collection('inflow_periods').doc(periodId).update;
      const updateArg = updateCall.mock.calls[0][0];
      expect(updateArg.occurrenceTransactionIds[0]).toBe(txnId);
    });

    it('should update occurrenceAmounts with actual received amount', async () => {
      const txnId = 'txn_008';
      const actualAmount = 2150.00; // Slight variance from expected
      mockTransactions.set(txnId, createMockTransaction(txnId, new Date('2025-01-10'), actualAmount));

      const periodId = 'inflow_001_2025-M01';
      mockInflowPeriods.set(periodId, createMockInflowPeriod(
        periodId, 'inflow_001', 'monthly',
        new Date('2025-01-01'), new Date('2025-01-31')
      ));

      const inflow = createMockInflow('inflow_001', [txnId]);

      await alignTransactionsToInflowPeriods(mockDb, 'inflow_001', inflow, [periodId]);

      const updateCall = mockDb.collection('inflow_periods').doc(periodId).update;
      const updateArg = updateCall.mock.calls[0][0];
      expect(updateArg.occurrenceAmounts[0]).toBe(actualAmount);
    });

    it('should match transaction to closest unpaid occurrence', async () => {
      const txnIds = ['txn_009', 'txn_010'];
      const dates = [new Date('2025-01-10'), new Date('2025-01-24')];

      txnIds.forEach((id, idx) => {
        mockTransactions.set(id, createMockTransaction(id, dates[idx], 2000));
      });

      const periodId = 'inflow_001_2025-M01';
      const period = createMockInflowPeriod(
        periodId, 'inflow_001', 'monthly',
        new Date('2025-01-01'), new Date('2025-01-31'),
        2
      );
      period.occurrenceDueDates = [
        Timestamp.fromDate(new Date('2025-01-10')),
        Timestamp.fromDate(new Date('2025-01-24'))
      ];
      mockInflowPeriods.set(periodId, period);

      const inflow = createMockInflow('inflow_001', txnIds);

      await alignTransactionsToInflowPeriods(mockDb, 'inflow_001', inflow, [periodId]);

      const updateCall = mockDb.collection('inflow_periods').doc(periodId).update;
      const updateArg = updateCall.mock.calls[0][0];

      // Both occurrences should be marked as paid
      expect(updateArg.occurrencePaidFlags).toEqual([true, true]);
      expect(updateArg.occurrenceTransactionIds[0]).toBe('txn_009');
      expect(updateArg.occurrenceTransactionIds[1]).toBe('txn_010');
    });
  });

  // ============================================================================
  // TOTAL RECALCULATION TESTS
  // ============================================================================

  describe('Total recalculation', () => {
    it('should update totalAmountPaid correctly', async () => {
      const txnId = 'txn_011';
      mockTransactions.set(txnId, createMockTransaction(txnId, new Date('2025-01-10'), 2000));

      const periodId = 'inflow_001_2025-M01';
      mockInflowPeriods.set(periodId, createMockInflowPeriod(
        periodId, 'inflow_001', 'monthly',
        new Date('2025-01-01'), new Date('2025-01-31')
      ));

      const inflow = createMockInflow('inflow_001', [txnId]);

      await alignTransactionsToInflowPeriods(mockDb, 'inflow_001', inflow, [periodId]);

      const updateCall = mockDb.collection('inflow_periods').doc(periodId).update;
      const updateArg = updateCall.mock.calls[0][0];
      expect(updateArg.totalAmountPaid).toBe(2000);
    });

    it('should update totalAmountUnpaid correctly', async () => {
      const txnId = 'txn_012';
      mockTransactions.set(txnId, createMockTransaction(txnId, new Date('2025-01-10'), 2000));

      const periodId = 'inflow_001_2025-M01';
      const period = createMockInflowPeriod(
        periodId, 'inflow_001', 'monthly',
        new Date('2025-01-01'), new Date('2025-01-31'),
        2 // Two occurrences, only one paid
      );
      period.totalAmountDue = 4000;
      mockInflowPeriods.set(periodId, period);

      const inflow = createMockInflow('inflow_001', [txnId]);

      await alignTransactionsToInflowPeriods(mockDb, 'inflow_001', inflow, [periodId]);

      const updateCall = mockDb.collection('inflow_periods').doc(periodId).update;
      const updateArg = updateCall.mock.calls[0][0];
      expect(updateArg.totalAmountUnpaid).toBe(2000); // 4000 - 2000
    });

    it('should set isFullyPaid when all occurrences received', async () => {
      const txnIds = ['txn_013', 'txn_014'];
      const dates = [new Date('2025-01-10'), new Date('2025-01-24')];

      txnIds.forEach((id, idx) => {
        mockTransactions.set(id, createMockTransaction(id, dates[idx], 2000));
      });

      const periodId = 'inflow_001_2025-M01';
      const period = createMockInflowPeriod(
        periodId, 'inflow_001', 'monthly',
        new Date('2025-01-01'), new Date('2025-01-31'),
        2
      );
      mockInflowPeriods.set(periodId, period);

      const inflow = createMockInflow('inflow_001', txnIds);

      await alignTransactionsToInflowPeriods(mockDb, 'inflow_001', inflow, [periodId]);

      const updateCall = mockDb.collection('inflow_periods').doc(periodId).update;
      const updateArg = updateCall.mock.calls[0][0];
      expect(updateArg.isFullyPaid).toBe(true);
      expect(updateArg.isPartiallyPaid).toBe(false);
    });

    it('should set isPartiallyPaid when some occurrences received', async () => {
      const txnId = 'txn_015';
      mockTransactions.set(txnId, createMockTransaction(txnId, new Date('2025-01-10'), 2000));

      const periodId = 'inflow_001_2025-M01';
      const period = createMockInflowPeriod(
        periodId, 'inflow_001', 'monthly',
        new Date('2025-01-01'), new Date('2025-01-31'),
        2 // Two occurrences, only one paid
      );
      mockInflowPeriods.set(periodId, period);

      const inflow = createMockInflow('inflow_001', [txnId]);

      await alignTransactionsToInflowPeriods(mockDb, 'inflow_001', inflow, [periodId]);

      const updateCall = mockDb.collection('inflow_periods').doc(periodId).update;
      const updateArg = updateCall.mock.calls[0][0];
      expect(updateArg.isPartiallyPaid).toBe(true);
      expect(updateArg.isFullyPaid).toBe(false);
    });
  });

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('Error handling', () => {
    it('should handle missing transactions gracefully', async () => {
      // No transactions in mock
      const inflow = createMockInflow('inflow_001', ['missing_txn']);
      const periodId = 'inflow_001_2025-M01';
      mockInflowPeriods.set(periodId, createMockInflowPeriod(
        periodId, 'inflow_001', 'monthly',
        new Date('2025-01-01'), new Date('2025-01-31')
      ));

      const result = await alignTransactionsToInflowPeriods(
        mockDb,
        'inflow_001',
        inflow,
        [periodId]
      );

      expect(result.transactionsProcessed).toBe(0);
      expect(result.transactionsMatched).toBe(0);
      // Should not throw, but may log warning
      expect(result.errors.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty transactionIds array', async () => {
      const inflow = createMockInflow('inflow_001', []);
      const periodId = 'inflow_001_2025-M01';
      mockInflowPeriods.set(periodId, createMockInflowPeriod(
        periodId, 'inflow_001', 'monthly',
        new Date('2025-01-01'), new Date('2025-01-31')
      ));

      const result = await alignTransactionsToInflowPeriods(
        mockDb,
        'inflow_001',
        inflow,
        [periodId]
      );

      expect(result.transactionsProcessed).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle transaction outside all period ranges', async () => {
      const txnId = 'txn_future';
      // Transaction from March, but only have January period
      mockTransactions.set(txnId, createMockTransaction(txnId, new Date('2025-03-15'), 2000));

      const periodId = 'inflow_001_2025-M01';
      mockInflowPeriods.set(periodId, createMockInflowPeriod(
        periodId, 'inflow_001', 'monthly',
        new Date('2025-01-01'), new Date('2025-01-31')
      ));

      const inflow = createMockInflow('inflow_001', [txnId]);

      const result = await alignTransactionsToInflowPeriods(
        mockDb,
        'inflow_001',
        inflow,
        [periodId]
      );

      // Transaction processed but not matched to period
      expect(result.transactionsProcessed).toBe(1);
      expect(result.transactionsMatched).toBe(0);
    });

    it('should skip inactive periods', async () => {
      const txnId = 'txn_016';
      mockTransactions.set(txnId, createMockTransaction(txnId, new Date('2025-01-15'), 2000));

      const periodId = 'inflow_001_2025-M01';
      const period = createMockInflowPeriod(
        periodId, 'inflow_001', 'monthly',
        new Date('2025-01-01'), new Date('2025-01-31')
      );
      period.isActive = false;
      mockInflowPeriods.set(periodId, period);

      const inflow = createMockInflow('inflow_001', [txnId]);

      const result = await alignTransactionsToInflowPeriods(
        mockDb,
        'inflow_001',
        inflow,
        [periodId]
      );

      // Should skip inactive period
      expect(result.periodsUpdated).toBe(0);
    });
  });

  // ============================================================================
  // INCREMENTAL UPDATE TESTS (onInflowUpdated scenario)
  // ============================================================================

  describe('Incremental updates (new transactions)', () => {
    it('should only process new transactions when called incrementally', async () => {
      const existingTxnId = 'txn_existing';
      const newTxnId = 'txn_new';

      mockTransactions.set(existingTxnId, createMockTransaction(existingTxnId, new Date('2025-01-10'), 2000));
      mockTransactions.set(newTxnId, createMockTransaction(newTxnId, new Date('2025-01-24'), 2000));

      const periodId = 'inflow_001_2025-M01';
      const period = createMockInflowPeriod(
        periodId, 'inflow_001', 'monthly',
        new Date('2025-01-01'), new Date('2025-01-31'),
        2
      );
      // First occurrence already matched
      period.occurrencePaidFlags = [true, false];
      period.occurrenceTransactionIds = [existingTxnId, null];
      period.numberOfOccurrencesPaid = 1;
      period.totalAmountPaid = 2000;
      mockInflowPeriods.set(periodId, period);

      // Inflow now has both transaction IDs
      const inflow = createMockInflow('inflow_001', [existingTxnId, newTxnId]);

      const result = await alignTransactionsToInflowPeriods(
        mockDb,
        'inflow_001',
        inflow,
        [periodId]
      );

      // Should only process the new transaction
      expect(result.transactionsMatched).toBe(1);

      const updateCall = mockDb.collection('inflow_periods').doc(periodId).update;
      const updateArg = updateCall.mock.calls[0][0];
      expect(updateArg.occurrencePaidFlags).toEqual([true, true]);
      expect(updateArg.occurrenceTransactionIds).toEqual([existingTxnId, newTxnId]);
    });
  });

  // ============================================================================
  // PLAID AMOUNT CONVERSION TESTS
  // ============================================================================

  describe('Plaid amount conversion', () => {
    it('should convert negative Plaid amount to positive', async () => {
      const txnId = 'txn_negative';
      const plaidAmount = -2500; // Plaid reports inflows as negative

      mockTransactions.set(txnId, {
        ...createMockTransaction(txnId, new Date('2025-01-15'), 0),
        amount: plaidAmount // Override with negative
      });

      const periodId = 'inflow_001_2025-M01';
      mockInflowPeriods.set(periodId, createMockInflowPeriod(
        periodId, 'inflow_001', 'monthly',
        new Date('2025-01-01'), new Date('2025-01-31')
      ));

      const inflow = createMockInflow('inflow_001', [txnId]);

      await alignTransactionsToInflowPeriods(mockDb, 'inflow_001', inflow, [periodId]);

      const updateCall = mockDb.collection('inflow_periods').doc(periodId).update;
      const updateArg = updateCall.mock.calls[0][0];

      // Amount should be stored as positive
      expect(updateArg.occurrenceAmounts[0]).toBe(2500);
      expect(updateArg.totalAmountPaid).toBe(2500);
    });
  });
});
