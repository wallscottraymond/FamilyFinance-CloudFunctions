/**
 * Emulator Integration Tests for alignTransactionsToInflowPeriods
 *
 * Tests the transaction-to-period matching logic using the Firebase Emulator
 * for accurate Firestore behavior.
 *
 * Prerequisites:
 * 1. Start emulators: firebase emulators:start
 * 2. Run tests: npm run test:emulator
 *
 * Test Scenarios:
 * 1. Single transaction matching to a period
 * 2. Multiple transactions across multiple periods
 * 3. Transaction matching to all three period types
 * 4. Occurrence tracking updates
 * 5. Amount calculations and totals
 * 6. Edge cases (no matching periods, already matched transactions)
 */

import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

// Initialize Firebase Admin for emulator
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'family-budget-app-cb59b'
  });
}

// Point to emulator
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

const db = admin.firestore();

// Import the function to test
import { alignTransactionsToInflowPeriods } from '../src/functions/inflows/inflow_periods/utils/alignTransactionsToInflowPeriods';
import { Inflow, InflowPeriod, PlaidRecurringFrequency } from '../src/types';

describe('alignTransactionsToInflowPeriods - Emulator Integration Tests', () => {
  const testUserId = `test-user-${Date.now()}`;
  const testInflowId = `test-inflow-${Date.now()}`;

  // Helper to create UTC date at noon
  const createUTCDate = (year: number, month: number, day: number): Date => {
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  };

  // Helper to clean up test data
  const cleanupTestData = async () => {
    // Delete test transactions
    const txnSnapshot = await db.collection('transactions')
      .where('ownerId', '==', testUserId)
      .get();
    const txnBatch = db.batch();
    txnSnapshot.docs.forEach(doc => txnBatch.delete(doc.ref));
    if (!txnSnapshot.empty) await txnBatch.commit();

    // Delete test inflow periods
    const periodSnapshot = await db.collection('inflow_periods')
      .where('ownerId', '==', testUserId)
      .get();
    const periodBatch = db.batch();
    periodSnapshot.docs.forEach(doc => periodBatch.delete(doc.ref));
    if (!periodSnapshot.empty) await periodBatch.commit();

    // Delete test inflows
    const inflowSnapshot = await db.collection('inflows')
      .where('ownerId', '==', testUserId)
      .get();
    const inflowBatch = db.batch();
    inflowSnapshot.docs.forEach(doc => inflowBatch.delete(doc.ref));
    if (!inflowSnapshot.empty) await inflowBatch.commit();
  };

  beforeAll(async () => {
    // Clean up any existing test data
    await cleanupTestData();
    console.log(`✅ Test setup complete for user: ${testUserId}`);
  });

  afterAll(async () => {
    // Clean up test data
    await cleanupTestData();
    console.log(`🗑️ Cleaned up test data for user: ${testUserId}`);
  });

  afterEach(async () => {
    // Clean up after each test
    await cleanupTestData();
  });

  // Helper to create a test inflow
  const createTestInflow = async (overrides: Partial<Inflow> = {}): Promise<string> => {
    const inflowData: Partial<Inflow> = {
      id: testInflowId,
      ownerId: testUserId,
      createdBy: testUserId,
      description: 'Test Biweekly Salary',
      frequency: PlaidRecurringFrequency.BIWEEKLY,
      averageAmount: 2000,
      lastAmount: 2000,
      currency: 'USD',
      firstDate: Timestamp.fromDate(createUTCDate(2025, 1, 3)),
      lastDate: Timestamp.fromDate(createUTCDate(2025, 1, 17)),
      predictedNextDate: Timestamp.fromDate(createUTCDate(2025, 1, 31)),
      incomeType: 'salary',
      isRegularSalary: true,
      isActive: true,
      isHidden: false,
      source: 'plaid',
      transactionIds: [],
      tags: [],
      ...overrides
    };

    await db.collection('inflows').doc(testInflowId).set(inflowData);
    return testInflowId;
  };

  // Helper to create a test transaction (Plaid-style with negative amount)
  const createTestTransaction = async (
    transactionId: string,
    date: Date,
    amount: number
  ): Promise<string> => {
    const txnData = {
      transactionId,
      ownerId: testUserId,
      amount: -Math.abs(amount), // Plaid inflows are negative
      date: Timestamp.fromDate(date),
      dateTransacted: Timestamp.fromDate(date),
      description: `Salary Payment ${transactionId}`,
      merchantName: 'Employer Inc',
      name: 'PAYROLL',
      isActive: true,
      status: 'posted',
      splits: [{
        splitId: `split_${transactionId}`,
        amount: Math.abs(amount),
        budgetId: 'unassigned',
        isDefault: true
      }],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    };

    const docRef = await db.collection('transactions').add(txnData);
    return docRef.id;
  };

  // Helper to create a test inflow period
  const createTestInflowPeriod = async (
    periodId: string,
    periodType: 'monthly' | 'weekly' | 'bi_monthly',
    startDate: Date,
    endDate: Date,
    occurrenceCount: number = 1,
    occurrenceDates: Date[] = []
  ): Promise<string> => {
    const dueDates = occurrenceDates.length > 0
      ? occurrenceDates.map(d => Timestamp.fromDate(d))
      : [Timestamp.fromDate(new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000))];

    const periodData: Partial<InflowPeriod> = {
      id: periodId,
      inflowId: testInflowId,
      ownerId: testUserId,
      periodType: periodType as any,
      periodStartDate: Timestamp.fromDate(startDate),
      periodEndDate: Timestamp.fromDate(endDate),
      numberOfOccurrencesInPeriod: occurrenceCount,
      numberOfOccurrencesPaid: 0,
      numberOfOccurrencesUnpaid: occurrenceCount,
      occurrenceDueDates: dueDates,
      occurrencePaidFlags: new Array(occurrenceCount).fill(false),
      occurrenceTransactionIds: new Array(occurrenceCount).fill(null),
      occurrenceAmounts: new Array(occurrenceCount).fill(0),
      transactionIds: [],
      totalAmountDue: 2000 * occurrenceCount,
      totalAmountPaid: 0,
      totalAmountUnpaid: 2000 * occurrenceCount,
      averageAmount: 2000,
      expectedAmount: 2000 * occurrenceCount,
      amountPerOccurrence: 2000,
      isFullyPaid: false,
      isPartiallyPaid: false,
      isReceiptPeriod: true,
      isActive: true,
      description: 'Test Biweekly Salary',
      frequency: 'BIWEEKLY',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    };

    await db.collection('inflow_periods').doc(periodId).set(periodData);
    return periodId;
  };

  // ============================================================================
  // TEST SUITE 1: Basic Transaction Matching
  // ============================================================================

  describe('1. Basic Transaction Matching', () => {
    test('should match a single transaction to a monthly period', async () => {
      // Setup: Create inflow, transaction, and period
      const transactionId = 'txn_001';
      await createTestInflow({
        transactionIds: [transactionId]
      });

      await createTestTransaction(
        transactionId,
        createUTCDate(2025, 1, 10),
        2000
      );

      const periodId = `${testInflowId}_2025-M01`;
      await createTestInflowPeriod(
        periodId,
        'monthly',
        createUTCDate(2025, 1, 1),
        createUTCDate(2025, 1, 31),
        1,
        [createUTCDate(2025, 1, 10)]
      );

      // Get the inflow document
      const inflowDoc = await db.collection('inflows').doc(testInflowId).get();
      const inflow = inflowDoc.data() as Inflow;

      // Execute
      const result = await alignTransactionsToInflowPeriods(
        db,
        testInflowId,
        inflow,
        [periodId]
      );

      // Verify result
      expect(result.transactionsProcessed).toBe(1);
      expect(result.transactionsMatched).toBe(1);
      expect(result.periodsUpdated).toBeGreaterThanOrEqual(1);
      expect(result.errors.length).toBe(0);

      // Verify period was updated
      const updatedPeriod = await db.collection('inflow_periods').doc(periodId).get();
      const periodData = updatedPeriod.data() as InflowPeriod;

      expect(periodData.numberOfOccurrencesPaid).toBe(1);
      expect(periodData.occurrencePaidFlags[0]).toBe(true);
      expect(periodData.occurrenceAmounts[0]).toBe(2000);
      expect(periodData.totalAmountPaid).toBe(2000);
      expect(periodData.isFullyPaid).toBe(true);
    });

    test('should match multiple transactions to correct periods', async () => {
      // Setup: Create inflow with 3 transactions
      const transactionIds = ['txn_jan1', 'txn_jan2', 'txn_feb1'];
      await createTestInflow({
        transactionIds
      });

      // Create transactions
      await createTestTransaction('txn_jan1', createUTCDate(2025, 1, 3), 2000);
      await createTestTransaction('txn_jan2', createUTCDate(2025, 1, 17), 2000);
      await createTestTransaction('txn_feb1', createUTCDate(2025, 2, 1), 2100);

      // Create periods
      const janPeriodId = `${testInflowId}_2025-M01`;
      const febPeriodId = `${testInflowId}_2025-M02`;

      await createTestInflowPeriod(
        janPeriodId,
        'monthly',
        createUTCDate(2025, 1, 1),
        createUTCDate(2025, 1, 31),
        2,
        [createUTCDate(2025, 1, 3), createUTCDate(2025, 1, 17)]
      );

      await createTestInflowPeriod(
        febPeriodId,
        'monthly',
        createUTCDate(2025, 2, 1),
        createUTCDate(2025, 2, 28),
        1,
        [createUTCDate(2025, 2, 1)]
      );

      // Execute
      const inflowDoc = await db.collection('inflows').doc(testInflowId).get();
      const inflow = inflowDoc.data() as Inflow;

      const result = await alignTransactionsToInflowPeriods(
        db,
        testInflowId,
        inflow,
        [janPeriodId, febPeriodId]
      );

      // Verify
      expect(result.transactionsProcessed).toBe(3);
      expect(result.transactionsMatched).toBe(3);
      expect(result.errors.length).toBe(0);

      // Check January period
      const janPeriod = await db.collection('inflow_periods').doc(janPeriodId).get();
      const janData = janPeriod.data() as InflowPeriod;
      expect(janData.numberOfOccurrencesPaid).toBe(2);
      expect(janData.totalAmountPaid).toBe(4000);
      expect(janData.isFullyPaid).toBe(true);

      // Check February period
      const febPeriod = await db.collection('inflow_periods').doc(febPeriodId).get();
      const febData = febPeriod.data() as InflowPeriod;
      expect(febData.numberOfOccurrencesPaid).toBe(1);
      expect(febData.totalAmountPaid).toBe(2100);
      expect(febData.isFullyPaid).toBe(true);
    });
  });

  // ============================================================================
  // TEST SUITE 2: Multi-Period Type Matching
  // ============================================================================

  describe('2. Multi-Period Type Matching', () => {
    test('should match transaction to all three period types', async () => {
      // Setup
      const transactionId = 'txn_multi';
      await createTestInflow({ transactionIds: [transactionId] });
      await createTestTransaction(transactionId, createUTCDate(2025, 1, 10), 2000);

      // Create all three period types
      const monthlyPeriodId = `${testInflowId}_2025-M01`;
      const weeklyPeriodId = `${testInflowId}_2025-W02`;
      const biMonthlyPeriodId = `${testInflowId}_2025-BM01-A`;

      await createTestInflowPeriod(
        monthlyPeriodId,
        'monthly',
        createUTCDate(2025, 1, 1),
        createUTCDate(2025, 1, 31),
        1,
        [createUTCDate(2025, 1, 10)]
      );

      await createTestInflowPeriod(
        weeklyPeriodId,
        'weekly',
        createUTCDate(2025, 1, 6),
        createUTCDate(2025, 1, 12),
        1,
        [createUTCDate(2025, 1, 10)]
      );

      await createTestInflowPeriod(
        biMonthlyPeriodId,
        'bi_monthly',
        createUTCDate(2025, 1, 1),
        createUTCDate(2025, 1, 15),
        1,
        [createUTCDate(2025, 1, 10)]
      );

      // Execute
      const inflowDoc = await db.collection('inflows').doc(testInflowId).get();
      const inflow = inflowDoc.data() as Inflow;

      const result = await alignTransactionsToInflowPeriods(
        db,
        testInflowId,
        inflow,
        [monthlyPeriodId, weeklyPeriodId, biMonthlyPeriodId]
      );

      // Verify
      expect(result.transactionsProcessed).toBe(1);
      expect(result.transactionsMatched).toBe(1);
      expect(result.periodsUpdated).toBe(3);

      // Check all periods were updated
      for (const periodId of [monthlyPeriodId, weeklyPeriodId, biMonthlyPeriodId]) {
        const period = await db.collection('inflow_periods').doc(periodId).get();
        const data = period.data() as InflowPeriod;
        expect(data.numberOfOccurrencesPaid).toBe(1);
        expect(data.occurrenceAmounts[0]).toBe(2000);
        expect(data.isFullyPaid).toBe(true);
      }
    });
  });

  // ============================================================================
  // TEST SUITE 3: Occurrence Tracking
  // ============================================================================

  describe('3. Occurrence Tracking', () => {
    test('should correctly track multiple occurrences in a single period', async () => {
      // Setup: Biweekly salary with 2 occurrences in January
      const transactionIds = ['txn_occ1', 'txn_occ2'];
      await createTestInflow({ transactionIds });

      await createTestTransaction('txn_occ1', createUTCDate(2025, 1, 3), 2000);
      await createTestTransaction('txn_occ2', createUTCDate(2025, 1, 17), 2000);

      const periodId = `${testInflowId}_2025-M01`;
      await createTestInflowPeriod(
        periodId,
        'monthly',
        createUTCDate(2025, 1, 1),
        createUTCDate(2025, 1, 31),
        2,
        [createUTCDate(2025, 1, 3), createUTCDate(2025, 1, 17)]
      );

      // Execute
      const inflowDoc = await db.collection('inflows').doc(testInflowId).get();
      const inflow = inflowDoc.data() as Inflow;

      const result = await alignTransactionsToInflowPeriods(
        db,
        testInflowId,
        inflow,
        [periodId]
      );

      // Verify
      expect(result.transactionsProcessed).toBe(2);
      expect(result.transactionsMatched).toBe(2);

      const period = await db.collection('inflow_periods').doc(periodId).get();
      const data = period.data() as InflowPeriod;

      expect(data.numberOfOccurrencesPaid).toBe(2);
      expect(data.occurrencePaidFlags).toEqual([true, true]);
      expect(data.occurrenceAmounts).toEqual([2000, 2000]);
      expect(data.totalAmountPaid).toBe(4000);
      expect(data.isFullyPaid).toBe(true);
      expect(data.isPartiallyPaid).toBe(false);
    });

    test('should handle partial payment (some occurrences paid)', async () => {
      // Setup: Only pay first occurrence
      const transactionIds = ['txn_partial'];
      await createTestInflow({ transactionIds });

      await createTestTransaction('txn_partial', createUTCDate(2025, 1, 3), 2000);

      const periodId = `${testInflowId}_2025-M01`;
      await createTestInflowPeriod(
        periodId,
        'monthly',
        createUTCDate(2025, 1, 1),
        createUTCDate(2025, 1, 31),
        2, // Two occurrences expected
        [createUTCDate(2025, 1, 3), createUTCDate(2025, 1, 17)]
      );

      // Execute
      const inflowDoc = await db.collection('inflows').doc(testInflowId).get();
      const inflow = inflowDoc.data() as Inflow;

      const result = await alignTransactionsToInflowPeriods(
        db,
        testInflowId,
        inflow,
        [periodId]
      );

      // Verify
      expect(result.transactionsMatched).toBe(1);

      const period = await db.collection('inflow_periods').doc(periodId).get();
      const data = period.data() as InflowPeriod;

      expect(data.numberOfOccurrencesPaid).toBe(1);
      expect(data.numberOfOccurrencesUnpaid).toBe(1);
      expect(data.occurrencePaidFlags).toEqual([true, false]);
      expect(data.totalAmountPaid).toBe(2000);
      expect(data.totalAmountUnpaid).toBe(2000);
      expect(data.isFullyPaid).toBe(false);
      expect(data.isPartiallyPaid).toBe(true);
    });
  });

  // ============================================================================
  // TEST SUITE 4: Amount Handling
  // ============================================================================

  describe('4. Amount Handling', () => {
    test('should convert negative Plaid amounts to positive', async () => {
      // Plaid income transactions are negative
      const transactionId = 'txn_negative';
      await createTestInflow({ transactionIds: [transactionId] });

      // Transaction stored with negative amount (Plaid format)
      await createTestTransaction(transactionId, createUTCDate(2025, 1, 10), -2500);

      const periodId = `${testInflowId}_2025-M01`;
      await createTestInflowPeriod(
        periodId,
        'monthly',
        createUTCDate(2025, 1, 1),
        createUTCDate(2025, 1, 31),
        1,
        [createUTCDate(2025, 1, 10)]
      );

      // Execute
      const inflowDoc = await db.collection('inflows').doc(testInflowId).get();
      const inflow = inflowDoc.data() as Inflow;

      await alignTransactionsToInflowPeriods(db, testInflowId, inflow, [periodId]);

      // Verify amount is positive
      const period = await db.collection('inflow_periods').doc(periodId).get();
      const data = period.data() as InflowPeriod;

      expect(data.occurrenceAmounts[0]).toBe(2500);
      expect(data.totalAmountPaid).toBe(2500);
    });

    test('should handle variable income amounts', async () => {
      // Different amounts for each occurrence
      const transactionIds = ['txn_var1', 'txn_var2'];
      await createTestInflow({ transactionIds });

      await createTestTransaction('txn_var1', createUTCDate(2025, 1, 3), 1800);
      await createTestTransaction('txn_var2', createUTCDate(2025, 1, 17), 2200);

      const periodId = `${testInflowId}_2025-M01`;
      await createTestInflowPeriod(
        periodId,
        'monthly',
        createUTCDate(2025, 1, 1),
        createUTCDate(2025, 1, 31),
        2,
        [createUTCDate(2025, 1, 3), createUTCDate(2025, 1, 17)]
      );

      // Execute
      const inflowDoc = await db.collection('inflows').doc(testInflowId).get();
      const inflow = inflowDoc.data() as Inflow;

      await alignTransactionsToInflowPeriods(db, testInflowId, inflow, [periodId]);

      // Verify
      const period = await db.collection('inflow_periods').doc(periodId).get();
      const data = period.data() as InflowPeriod;

      expect(data.occurrenceAmounts).toEqual([1800, 2200]);
      expect(data.totalAmountPaid).toBe(4000);
    });
  });

  // ============================================================================
  // TEST SUITE 5: Edge Cases
  // ============================================================================

  describe('5. Edge Cases', () => {
    test('should handle empty transaction list gracefully', async () => {
      await createTestInflow({ transactionIds: [] });

      const periodId = `${testInflowId}_2025-M01`;
      await createTestInflowPeriod(
        periodId,
        'monthly',
        createUTCDate(2025, 1, 1),
        createUTCDate(2025, 1, 31)
      );

      const inflowDoc = await db.collection('inflows').doc(testInflowId).get();
      const inflow = inflowDoc.data() as Inflow;

      const result = await alignTransactionsToInflowPeriods(
        db,
        testInflowId,
        inflow,
        [periodId]
      );

      expect(result.transactionsProcessed).toBe(0);
      expect(result.transactionsMatched).toBe(0);
      expect(result.periodsUpdated).toBe(0);
      expect(result.errors.length).toBe(0);
    });

    test('should handle transaction with no matching period', async () => {
      // Transaction date outside any period
      const transactionId = 'txn_nomatch';
      await createTestInflow({ transactionIds: [transactionId] });

      // Transaction in March
      await createTestTransaction(transactionId, createUTCDate(2025, 3, 15), 2000);

      // Only create January period
      const periodId = `${testInflowId}_2025-M01`;
      await createTestInflowPeriod(
        periodId,
        'monthly',
        createUTCDate(2025, 1, 1),
        createUTCDate(2025, 1, 31)
      );

      const inflowDoc = await db.collection('inflows').doc(testInflowId).get();
      const inflow = inflowDoc.data() as Inflow;

      const result = await alignTransactionsToInflowPeriods(
        db,
        testInflowId,
        inflow,
        [periodId]
      );

      // Transaction processed but not matched to this period
      expect(result.transactionsProcessed).toBe(1);
      expect(result.transactionsMatched).toBe(0);
      expect(result.periodsUpdated).toBe(0);
    });

    test('should handle missing inflow userId', async () => {
      // Create inflow without ownerId
      await db.collection('inflows').doc(testInflowId).set({
        description: 'Test',
        frequency: 'BIWEEKLY',
        transactionIds: ['txn_test']
        // No ownerId
      });

      const inflowDoc = await db.collection('inflows').doc(testInflowId).get();
      const inflow = inflowDoc.data() as Inflow;

      const result = await alignTransactionsToInflowPeriods(
        db,
        testInflowId,
        inflow,
        []
      );

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('userId');
    });
  });

  // ============================================================================
  // TEST SUITE 6: Progress Metrics
  // ============================================================================

  describe('6. Progress Metrics', () => {
    test('should calculate correct payment progress percentage', async () => {
      // Pay 1 of 2 occurrences = 50%
      const transactionIds = ['txn_progress'];
      await createTestInflow({ transactionIds });

      await createTestTransaction('txn_progress', createUTCDate(2025, 1, 3), 2000);

      const periodId = `${testInflowId}_2025-M01`;
      await createTestInflowPeriod(
        periodId,
        'monthly',
        createUTCDate(2025, 1, 1),
        createUTCDate(2025, 1, 31),
        2,
        [createUTCDate(2025, 1, 3), createUTCDate(2025, 1, 17)]
      );

      const inflowDoc = await db.collection('inflows').doc(testInflowId).get();
      const inflow = inflowDoc.data() as Inflow;

      await alignTransactionsToInflowPeriods(db, testInflowId, inflow, [periodId]);

      const period = await db.collection('inflow_periods').doc(periodId).get();
      const data = period.data() as InflowPeriod;

      // 1 of 2 = 50%
      expect(data.paymentProgressPercentage).toBe(50);
    });

    test('should calculate correct dollar progress percentage', async () => {
      // Pay $1500 of $4000 expected = 37.5%
      const transactionIds = ['txn_dollar'];
      await createTestInflow({ transactionIds });

      await createTestTransaction('txn_dollar', createUTCDate(2025, 1, 3), 1500);

      const periodId = `${testInflowId}_2025-M01`;
      await createTestInflowPeriod(
        periodId,
        'monthly',
        createUTCDate(2025, 1, 1),
        createUTCDate(2025, 1, 31),
        2,
        [createUTCDate(2025, 1, 3), createUTCDate(2025, 1, 17)]
      );

      const inflowDoc = await db.collection('inflows').doc(testInflowId).get();
      const inflow = inflowDoc.data() as Inflow;

      await alignTransactionsToInflowPeriods(db, testInflowId, inflow, [periodId]);

      const period = await db.collection('inflow_periods').doc(periodId).get();
      const data = period.data() as InflowPeriod;

      // $1500 / $4000 = 37.5% (implementation may round)
      expect(data.dollarProgressPercentage).toBeGreaterThanOrEqual(37);
      expect(data.dollarProgressPercentage).toBeLessThanOrEqual(38);
    });
  });
});
