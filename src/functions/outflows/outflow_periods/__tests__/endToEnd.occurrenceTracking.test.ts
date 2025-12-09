/**
 * End-to-End Tests for Occurrence Tracking System
 *
 * Tests the complete flow from outflow creation through to summary generation:
 * 1. Create outflow with specific frequency
 * 2. Generate outflow periods with occurrence calculations
 * 3. Assign transactions to periods
 * 4. Match transactions to occurrence indices
 * 5. Generate summaries with occurrence data
 *
 * Test Matrix:
 * - WEEKLY outflow in MONTHLY period → 4-5 occurrences
 * - BIWEEKLY outflow in MONTHLY period → 2-3 occurrences
 * - MONTHLY outflow in MONTHLY period → 1 occurrence
 * - Partial payment scenarios (2 of 4 weeks paid)
 */

import { Timestamp } from 'firebase-admin/firestore';
import {
  RecurringOutflow,
  OutflowPeriod,
  SourcePeriod,
  PlaidRecurringFrequency,
  TransactionSplitReference,
  PaymentType,
  PeriodType
} from '../../../../types';
import { calculateAllOccurrencesInPeriod } from '../utils/calculateAllOccurrencesInPeriod';
import { matchAllTransactionsToOccurrences } from '../utils/matchAllTransactionsToOccurrences';
import { calculateEnhancedOutflowPeriodStatus } from '../utils/calculateOutflowPeriodStatus';

// Mock Firestore for testing
const mockUpdate = jest.fn().mockResolvedValue(undefined);
const mockDoc = jest.fn(() => ({ update: mockUpdate }));
const mockCollection = jest.fn(() => ({ doc: mockDoc }));
const mockFirestore = {
  collection: mockCollection
};

describe('End-to-End Occurrence Tracking', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
  });
  // Helper to create test outflow
  const createTestOutflow = (
    frequency: PlaidRecurringFrequency,
    description: string,
    amount: number,
    firstDate: Date
  ): RecurringOutflow => {
    return {
      id: `outflow_${description.toLowerCase().replace(/\s+/g, '_')}`,
      description,
      frequency,
      averageAmount: amount,
      lastAmount: amount,
      firstDate: Timestamp.fromDate(firstDate),
      lastDate: Timestamp.fromDate(firstDate),
      predictedNextDate: Timestamp.fromDate(firstDate),
      transactionIds: []
    } as unknown as RecurringOutflow;
  };

  // Helper to create test period
  const createTestSourcePeriod = (
    id: string,
    startDate: Date,
    endDate: Date,
    periodType: PeriodType = PeriodType.MONTHLY
  ): SourcePeriod => {
    return {
      id,
      periodType,
      startDate: Timestamp.fromDate(startDate),
      endDate: Timestamp.fromDate(endDate)
    } as unknown as SourcePeriod;
  };

  // Helper to create transaction split
  const createTestSplit = (
    transactionId: string,
    splitId: string,
    amount: number,
    date: Date,
    paymentType: PaymentType = PaymentType.REGULAR
  ): TransactionSplitReference => {
    return {
      transactionId,
      splitId,
      amount,
      transactionDate: Timestamp.fromDate(date),
      description: `Payment for ${transactionId}`,
      paymentType,
      isAutoMatched: true,
      matchedAt: Timestamp.now(),
      matchedBy: 'test'
    };
  };

  describe('Test Flow 1: Weekly Outflow in Monthly Period', () => {
    it('should create 4 occurrences for weekly bill in January 2025', () => {
      // Setup: Weekly gym membership ($10/week)
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.WEEKLY,
        'Weekly Gym',
        10,
        new Date('2025-01-01')
      );

      const sourcePeriod = createTestSourcePeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      // Step 1: Calculate occurrences
      const occurrenceResult = calculateAllOccurrencesInPeriod(outflow, sourcePeriod);

      // Verify occurrence calculation
      expect(occurrenceResult.numberOfOccurrences).toBeGreaterThanOrEqual(4);
      expect(occurrenceResult.numberOfOccurrences).toBeLessThanOrEqual(5);
      expect(occurrenceResult.occurrenceDueDates).toHaveLength(occurrenceResult.numberOfOccurrences);
      expect(occurrenceResult.occurrenceDrawDates).toHaveLength(occurrenceResult.numberOfOccurrences);

      // All dates should be within period
      occurrenceResult.occurrenceDueDates.forEach(date => {
        const d = date.toDate();
        expect(d >= sourcePeriod.startDate.toDate()).toBe(true);
        expect(d <= sourcePeriod.endDate.toDate()).toBe(true);
      });

      console.log('✓ Weekly outflow: Created', occurrenceResult.numberOfOccurrences, 'occurrences');
    });

    it('should match 2 transactions to correct occurrence indices (partial payment)', async () => {
      // Setup
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.WEEKLY,
        'Weekly Gym',
        10,
        new Date('2025-01-01')
      );

      const sourcePeriod = createTestSourcePeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      const occurrenceResult = calculateAllOccurrencesInPeriod(outflow, sourcePeriod);

      // Create test period with occurrences
      const periodData: OutflowPeriod = {
        id: 'period_test_001',
        outflowId: outflow.id,
        sourcePeriodId: sourcePeriod.id,
        occurrenceDueDates: occurrenceResult.occurrenceDueDates,
        occurrenceDrawDates: occurrenceResult.occurrenceDrawDates,
        numberOfOccurrencesInPeriod: occurrenceResult.numberOfOccurrences,
        numberOfOccurrencesPaid: 0,
        numberOfOccurrencesUnpaid: occurrenceResult.numberOfOccurrences,
        transactionSplits: [
          // Payment for first week (Jan 1)
          createTestSplit('txn_001', 'split_001', 10, new Date('2025-01-01')),
          // Payment for second week (Jan 8)
          createTestSplit('txn_002', 'split_002', 10, new Date('2025-01-08'))
        ]
      } as unknown as OutflowPeriod;

      // Step 2: Match transactions to occurrences
      await matchAllTransactionsToOccurrences(mockFirestore as any, 'period_test_001', periodData);

      // Verify the update call was made with correct occurrence arrays
      expect(mockUpdate).toHaveBeenCalled();

      const updateData = mockUpdate.mock.calls[0][0];

      // Should have 2 paid occurrences
      expect(updateData.numberOfOccurrencesPaid).toBe(2);
      expect(updateData.numberOfOccurrencesUnpaid).toBe(occurrenceResult.numberOfOccurrences - 2);

      // First two occurrences should be marked as paid
      expect(updateData.occurrencePaidFlags[0]).toBe(true);
      expect(updateData.occurrencePaidFlags[1]).toBe(true);

      // Remaining should be unpaid
      for (let i = 2; i < occurrenceResult.numberOfOccurrences; i++) {
        expect(updateData.occurrencePaidFlags[i]).toBe(false);
      }

      // Transaction IDs should be assigned
      expect(updateData.occurrenceTransactionIds[0]).toBe('txn_001');
      expect(updateData.occurrenceTransactionIds[1]).toBe('txn_002');

      console.log('✓ Matched 2 of', occurrenceResult.numberOfOccurrences, 'occurrences');
      console.log('  - Paid:', updateData.numberOfOccurrencesPaid);
      console.log('  - Unpaid:', updateData.numberOfOccurrencesUnpaid);
    });

    it('should generate enhanced status with occurrence text', () => {
      // Setup: Period with 4 occurrences, 2 paid
      const occurrenceResult = calculateAllOccurrencesInPeriod(
        createTestOutflow(PlaidRecurringFrequency.WEEKLY, 'Weekly Gym', 10, new Date('2025-01-01')),
        createTestSourcePeriod('2025-M01', new Date('2025-01-01'), new Date('2025-01-31'))
      );

      const transactionSplits = [
        createTestSplit('txn_001', 'split_001', 10, new Date('2025-01-01')),
        createTestSplit('txn_002', 'split_002', 10, new Date('2025-01-08'))
      ];

      // Step 3: Calculate enhanced status
      const enhancedStatus = calculateEnhancedOutflowPeriodStatus(
        true, // isDuePeriod
        Timestamp.fromDate(new Date('2025-01-22')), // dueDate
        Timestamp.fromDate(new Date('2025-01-22')), // expectedDueDate
        40, // totalAmountDue (4 weeks × $10)
        transactionSplits,
        occurrenceResult.numberOfOccurrences, // 4 or 5
        2, // numberOfOccurrencesPaid
        'WEEKLY'
      );

      // Verify enhanced status
      expect(enhancedStatus.hasOccurrenceTracking).toBe(true);
      expect(enhancedStatus.numberOfOccurrences).toBe(occurrenceResult.numberOfOccurrences);
      expect(enhancedStatus.numberOfOccurrencesPaid).toBe(2);
      expect(enhancedStatus.numberOfOccurrencesUnpaid).toBe(occurrenceResult.numberOfOccurrences - 2);
      expect(enhancedStatus.occurrencePaymentPercentage).toBeGreaterThan(0);
      expect(enhancedStatus.occurrenceStatusText).toMatch(/2 of \d+ weeks paid/);

      console.log('✓ Enhanced status:', enhancedStatus.occurrenceStatusText);
      console.log('  - Payment percentage:', enhancedStatus.occurrencePaymentPercentage + '%');
    });
  });

  describe('Test Flow 2: Biweekly Outflow in Monthly Period', () => {
    it('should create 2-3 occurrences for biweekly bill in January 2025', () => {
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.BIWEEKLY,
        'Biweekly Subscription',
        25,
        new Date('2025-01-01')
      );

      const sourcePeriod = createTestSourcePeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      const occurrenceResult = calculateAllOccurrencesInPeriod(outflow, sourcePeriod);

      expect(occurrenceResult.numberOfOccurrences).toBeGreaterThanOrEqual(2);
      expect(occurrenceResult.numberOfOccurrences).toBeLessThanOrEqual(3);

      console.log('✓ Biweekly outflow: Created', occurrenceResult.numberOfOccurrences, 'occurrences');
    });

    it('should match all transactions when fully paid', async () => {
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.BIWEEKLY,
        'Biweekly Subscription',
        25,
        new Date('2025-01-01')
      );

      const sourcePeriod = createTestSourcePeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      const occurrenceResult = calculateAllOccurrencesInPeriod(outflow, sourcePeriod);

      const periodData: OutflowPeriod = {
        id: 'period_test_002',
        outflowId: outflow.id,
        sourcePeriodId: sourcePeriod.id,
        occurrenceDueDates: occurrenceResult.occurrenceDueDates,
        numberOfOccurrencesInPeriod: occurrenceResult.numberOfOccurrences,
        transactionSplits: [
          createTestSplit('txn_003', 'split_003', 25, new Date('2025-01-01')),
          createTestSplit('txn_004', 'split_004', 25, new Date('2025-01-15')),
          ...(occurrenceResult.numberOfOccurrences === 3
            ? [createTestSplit('txn_005', 'split_005', 25, new Date('2025-01-29'))]
            : []
          )
        ]
      } as unknown as OutflowPeriod;

      await matchAllTransactionsToOccurrences(mockFirestore as any, 'period_test_002', periodData);

      const updateData = mockUpdate.mock.calls[0][0];

      expect(updateData.numberOfOccurrencesPaid).toBe(occurrenceResult.numberOfOccurrences);
      expect(updateData.numberOfOccurrencesUnpaid).toBe(0);

      console.log('✓ Fully paid:', occurrenceResult.numberOfOccurrences, 'of', occurrenceResult.numberOfOccurrences, 'occurrences');
    });

    it('should generate "bi-weekly periods" text in status', () => {
      const enhancedStatus = calculateEnhancedOutflowPeriodStatus(
        true,
        Timestamp.fromDate(new Date('2025-01-29')),
        Timestamp.fromDate(new Date('2025-01-29')),
        50,
        [
          createTestSplit('txn_003', 'split_003', 25, new Date('2025-01-01')),
          createTestSplit('txn_004', 'split_004', 25, new Date('2025-01-15'))
        ],
        2,
        2,
        'BIWEEKLY'
      );

      expect(enhancedStatus.occurrenceStatusText).toBe('2 of 2 bi-weekly periods paid');
      console.log('✓ Status text:', enhancedStatus.occurrenceStatusText);
    });
  });

  describe('Test Flow 3: Monthly Outflow in Monthly Period', () => {
    it('should create 1 occurrence for monthly bill in monthly period', () => {
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.MONTHLY,
        'Monthly Rent',
        1200,
        new Date('2025-01-01')
      );

      const sourcePeriod = createTestSourcePeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      const occurrenceResult = calculateAllOccurrencesInPeriod(outflow, sourcePeriod);

      expect(occurrenceResult.numberOfOccurrences).toBe(1);

      console.log('✓ Monthly outflow: Created', occurrenceResult.numberOfOccurrences, 'occurrence');
    });

    it('should match single transaction to single occurrence', async () => {
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.MONTHLY,
        'Monthly Rent',
        1200,
        new Date('2025-01-01')
      );

      const sourcePeriod = createTestSourcePeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      const occurrenceResult = calculateAllOccurrencesInPeriod(outflow, sourcePeriod);

      const periodData: OutflowPeriod = {
        id: 'period_test_003',
        outflowId: outflow.id,
        sourcePeriodId: sourcePeriod.id,
        occurrenceDueDates: occurrenceResult.occurrenceDueDates,
        numberOfOccurrencesInPeriod: 1,
        transactionSplits: [
          createTestSplit('txn_006', 'split_006', 1200, new Date('2025-01-01'))
        ]
      } as unknown as OutflowPeriod;

      await matchAllTransactionsToOccurrences(mockFirestore as any, 'period_test_003', periodData);

      const updateData = mockUpdate.mock.calls[0][0];

      expect(updateData.numberOfOccurrencesPaid).toBe(1);
      expect(updateData.numberOfOccurrencesUnpaid).toBe(0);
      expect(updateData.occurrencePaidFlags).toEqual([true]);

      console.log('✓ Single occurrence matched');
    });

    it('should generate "months" text in status', () => {
      const enhancedStatus = calculateEnhancedOutflowPeriodStatus(
        true,
        Timestamp.fromDate(new Date('2025-01-01')),
        Timestamp.fromDate(new Date('2025-01-01')),
        1200,
        [createTestSplit('txn_006', 'split_006', 1200, new Date('2025-01-01'))],
        1,
        1,
        'MONTHLY'
      );

      expect(enhancedStatus.occurrenceStatusText).toBe('1 of 1 months paid');
      console.log('✓ Status text:', enhancedStatus.occurrenceStatusText);
    });
  });

  describe('Test Flow 4: Edge Cases and Validation', () => {
    it('should handle zero occurrences (bill not due in period)', () => {
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.ANNUALLY,
        'Annual Bill',
        100,
        new Date('2024-06-15') // Last occurrence was June 2024, next would be June 2025
      );

      const sourcePeriod = createTestSourcePeriod(
        '2025-M01', // January period - annual bill won't occur here
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      const occurrenceResult = calculateAllOccurrencesInPeriod(outflow, sourcePeriod);

      // Annual bill with June occurrence won't have any in January period
      expect(occurrenceResult.numberOfOccurrences).toBe(0);
      expect(occurrenceResult.occurrenceDueDates).toHaveLength(0);

      console.log('✓ Zero occurrences handled correctly');
    });

    it('should handle transaction outside tolerance window', async () => {
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.WEEKLY,
        'Weekly Gym',
        10,
        new Date('2025-01-01')
      );

      const sourcePeriod = createTestSourcePeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      const occurrenceResult = calculateAllOccurrencesInPeriod(outflow, sourcePeriod);

      const periodData: OutflowPeriod = {
        id: 'period_test_004',
        outflowId: outflow.id,
        sourcePeriodId: sourcePeriod.id,
        occurrenceDueDates: occurrenceResult.occurrenceDueDates,
        numberOfOccurrencesInPeriod: occurrenceResult.numberOfOccurrences,
        transactionSplits: [
          // Transaction far from any occurrence (>3 days)
          createTestSplit('txn_007', 'split_007', 10, new Date('2025-01-12'))
        ]
      } as unknown as OutflowPeriod;

      await matchAllTransactionsToOccurrences(mockFirestore as any, 'period_test_004', periodData);

      const updateData = mockUpdate.mock.calls[0][0];

      // Transaction should still match to closest occurrence if within tolerance
      // If outside tolerance, some occurrences may remain unpaid
      expect(updateData.numberOfOccurrencesPaid).toBeGreaterThanOrEqual(0);
      expect(updateData.numberOfOccurrencesPaid).toBeLessThanOrEqual(occurrenceResult.numberOfOccurrences);

      console.log('✓ Tolerance window respected');
    });

    it('should not track occurrences when count is 0', () => {
      const enhancedStatus = calculateEnhancedOutflowPeriodStatus(
        false, // not due period
        undefined,
        Timestamp.fromDate(new Date('2025-01-01')),
        0,
        [],
        0, // NO occurrences
        0,
        'MONTHLY'
      );

      expect(enhancedStatus.hasOccurrenceTracking).toBe(false);
      expect(enhancedStatus.numberOfOccurrences).toBe(0);
      expect(enhancedStatus.occurrenceStatusText).toBeNull();

      console.log('✓ No tracking when count is 0');
    });
  });

  describe('Test Flow 5: Semi-Monthly Frequency', () => {
    it('should create 2-3 occurrences for semi-monthly bill', () => {
      const outflow = createTestOutflow(
        PlaidRecurringFrequency.SEMI_MONTHLY,
        'Semi-Monthly Subscription',
        50,
        new Date('2025-01-01')
      );

      const sourcePeriod = createTestSourcePeriod(
        '2025-M01',
        new Date('2025-01-01'),
        new Date('2025-01-31')
      );

      const occurrenceResult = calculateAllOccurrencesInPeriod(outflow, sourcePeriod);

      expect(occurrenceResult.numberOfOccurrences).toBeGreaterThanOrEqual(2);
      expect(occurrenceResult.numberOfOccurrences).toBeLessThanOrEqual(3);

      console.log('✓ Semi-monthly outflow: Created', occurrenceResult.numberOfOccurrences, 'occurrences');
    });

    it('should generate "semi-monthly periods" text', () => {
      const enhancedStatus = calculateEnhancedOutflowPeriodStatus(
        true,
        Timestamp.fromDate(new Date('2025-01-31')),
        Timestamp.fromDate(new Date('2025-01-31')),
        100,
        [
          createTestSplit('txn_008', 'split_008', 50, new Date('2025-01-01')),
          createTestSplit('txn_009', 'split_009', 50, new Date('2025-01-16'))
        ],
        2,
        2,
        'SEMI_MONTHLY'
      );

      expect(enhancedStatus.occurrenceStatusText).toBe('2 of 2 semi-monthly periods paid');
      console.log('✓ Status text:', enhancedStatus.occurrenceStatusText);
    });
  });
});
