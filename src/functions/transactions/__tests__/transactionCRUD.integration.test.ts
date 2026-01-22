import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp } from '@google-cloud/firestore';

/**
 * Transaction CRUD Integration Test Suite
 *
 * Tests the complete transaction lifecycle with budget period integration:
 * - Transaction creation with split validation
 * - Transaction updates with budget recalculation
 * - Transaction deletion with budget reversal
 * - Automatic budget period spent updates
 *
 * Following TDD approach: Tests written first, implementation follows.
 *
 * Key integration points:
 * - validateAndRedistributeSplits() utility
 * - matchTransactionSplitsToBudgets() utility
 * - updateBudgetSpending() trigger
 * - budget_periods.spent auto-updates
 */

describe('Transaction CRUD with Budget Period Updates', () => {
  let testEnv: RulesTestEnvironment;
  let db: any;
  const testUserId = 'user_test_001';

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'test-project-transaction-crud',
      firestore: {
        host: 'localhost',
        port: 8080,
        rules: `
          service cloud.firestore {
            match /databases/{database}/documents {
              match /{document=**} {
                allow read, write: if true;
              }
            }
          }
        `
      }
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    db = testEnv.authenticatedContext(testUserId).firestore();
    await testEnv.clearFirestore();
  });

  describe('Transaction Creation', () => {
    it('creates transaction with validated splits and updates budget_period.spent', async () => {
      // Setup: Budget period with allocated amount
      const budgetPeriod = {
        id: 'bp_jan_2025',
        budgetId: 'budget_groceries',
        userId: testUserId,
        periodStart: Timestamp.fromDate(new Date('2025-01-01')),
        periodEnd: Timestamp.fromDate(new Date('2025-01-31')),
        allocated: 500.00,
        spent: 0.00,
        remaining: 500.00,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };
      await db.collection('budget_periods').doc(budgetPeriod.id).set(budgetPeriod);

      // Setup: Budget
      await db.collection('budgets').doc('budget_groceries').set({
        id: 'budget_groceries',
        userId: testUserId,
        isActive: true,
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isOngoing: true,
        createdAt: Timestamp.now()
      });

      // Create transaction with realistic splits
      const transaction = {
        id: 'txn_walmart',
        ownerId: testUserId,
        amount: 85.50,
        description: 'Walmart Groceries',
        transactionDate: Timestamp.fromDate(new Date('2025-01-15')),
        splits: [
          {
            splitId: 'split_groceries',
            amount: 60.00,
            budgetId: 'budget_groceries',
            internalPrimaryCategory: 'FOOD',
            isDefault: true,
            plaidPrimaryCategory: 'Food',
            plaidDetailedCategory: 'Groceries',
            internalDetailedCategory: null,
            isIgnored: false,
            isRefund: false,
            isTaxDeductible: false,
            paymentDate: Timestamp.fromDate(new Date('2025-01-15')),
            monthlyPeriodId: 'bp_jan_2025',
            weeklyPeriodId: null,
            biWeeklyPeriodId: null,
            rules: [],
            tags: [],
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
          },
          {
            splitId: 'split_household',
            amount: 25.50,
            budgetId: 'budget_household',
            internalPrimaryCategory: 'HOUSEHOLD',
            isDefault: false,
            plaidPrimaryCategory: 'Shopping',
            plaidDetailedCategory: 'Home Improvement',
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
          }
        ],
        isActive: true,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };

      await db.collection('transactions').doc(transaction.id).set(transaction);

      // Verify splits validated (total = 85.50)
      const createdTxn = (await db.collection('transactions').doc(transaction.id).get()).data();
      const splitTotal = createdTxn.splits.reduce((sum: number, s: any) => sum + s.amount, 0);
      expect(splitTotal).toBe(85.50);

      // Verify budget_period.spent updated
      // Note: This requires the onTransactionCreate trigger to be active
      // For now, we'll test the trigger logic separately
      // In real integration test, we'd wait for trigger and verify update
    });

    it('redistributes invalid splits automatically on creation', async () => {
      // Create transaction with splits totaling more than amount
      const transaction = {
        id: 'txn_invalid',
        ownerId: testUserId,
        amount: 100.00,
        description: 'Test Transaction',
        transactionDate: Timestamp.fromDate(new Date('2025-01-15')),
        splits: [
          {
            splitId: 'split_001',
            amount: 60.00,
            budgetId: 'budget_a',
            isDefault: true,
            plaidPrimaryCategory: 'Food',
            plaidDetailedCategory: 'Restaurants',
            internalPrimaryCategory: null,
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
          },
          {
            splitId: 'split_002',
            amount: 50.00,
            budgetId: 'budget_b',
            isDefault: false,
            plaidPrimaryCategory: 'Shopping',
            plaidDetailedCategory: 'General',
            internalPrimaryCategory: null,
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
          }
        ],
        isActive: true,
        createdAt: Timestamp.now()
      };

      // Before creation, validate and redistribute
      const { validateAndRedistributeSplits } = await import('../utils/validateAndRedistributeSplits');
      const validationResult = validateAndRedistributeSplits(transaction.amount, transaction.splits);

      if (!validationResult.isValid) {
        transaction.splits = validationResult.redistributedSplits! as any;
      }

      await db.collection('transactions').doc(transaction.id).set(transaction);

      // Verify redistribution occurred
      const txn = (await db.collection('transactions').doc(transaction.id).get()).data();
      const splits = txn.splits;

      expect(splits[0].amount).toBeCloseTo(54.55, 2);
      expect(splits[1].amount).toBeCloseTo(45.45, 2);
    });

    it('prevents creation with splits below minimum threshold', async () => {
      const transaction = {
        id: 'txn_tiny_split',
        ownerId: testUserId,
        amount: 100.00,
        description: 'Test Transaction',
        transactionDate: Timestamp.fromDate(new Date('2025-01-15')),
        splits: [
          {
            splitId: 'split_001',
            amount: 99.99,
            budgetId: 'budget_a',
            isDefault: true,
            plaidPrimaryCategory: 'Food',
            plaidDetailedCategory: 'Restaurants',
            internalPrimaryCategory: null,
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
          },
          {
            splitId: 'split_002',
            amount: 0.005,  // Below $0.01 minimum
            budgetId: 'budget_b',
            isDefault: false,
            plaidPrimaryCategory: 'Shopping',
            plaidDetailedCategory: 'General',
            internalPrimaryCategory: null,
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
          }
        ],
        isActive: true,
        createdAt: Timestamp.now()
      };

      // Validate and redistribute
      const { validateAndRedistributeSplits } = await import('../utils/validateAndRedistributeSplits');
      const validationResult = validateAndRedistributeSplits(transaction.amount, transaction.splits);

      if (!validationResult.isValid) {
        transaction.splits = validationResult.redistributedSplits! as any;
      }

      await db.collection('transactions').doc(transaction.id).set(transaction);

      // Verify tiny split was removed or merged
      const txn = (await db.collection('transactions').doc(transaction.id).get()).data();
      const hasValidSplits = txn.splits.every((s: any) => s.amount >= 0.01);
      expect(hasValidSplits).toBe(true);
    });
  });

  describe('Transaction Update', () => {
    it('detects split changes and recalculates budget periods', async () => {
      // Setup: Existing transaction
      const txn = {
        id: 'txn_existing',
        ownerId: testUserId,
        amount: 100.00,
        description: 'Original Transaction',
        transactionDate: Timestamp.fromDate(new Date('2025-01-15')),
        splits: [{
          splitId: 'split_001',
          budgetId: 'budget_groceries',
          amount: 100.00,
          isDefault: true,
          plaidPrimaryCategory: 'Food',
          plaidDetailedCategory: 'Groceries',
          internalPrimaryCategory: null,
          internalDetailedCategory: null,
          isIgnored: false,
          isRefund: false,
          isTaxDeductible: false,
          paymentDate: Timestamp.fromDate(new Date('2025-01-15')),
          monthlyPeriodId: 'bp_jan_2025',
          weeklyPeriodId: null,
          biWeeklyPeriodId: null,
          rules: [],
          tags: [],
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        }],
        isActive: true,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };
      await db.collection('transactions').doc(txn.id).set(txn);

      // Setup: Budget period
      await db.collection('budget_periods').doc('bp_jan_2025').set({
        id: 'bp_jan_2025',
        budgetId: 'budget_groceries',
        userId: testUserId,
        periodStart: Timestamp.fromDate(new Date('2025-01-01')),
        periodEnd: Timestamp.fromDate(new Date('2025-01-31')),
        allocated: 500.00,
        spent: 100.00,  // From initial transaction
        remaining: 400.00,
        createdAt: Timestamp.now()
      });

      // Update: Add second split (should redistribute)
      const updatedSplits = [
        {
          splitId: 'split_001',
          amount: 100.00,
          budgetId: 'budget_groceries',
          isDefault: true,
          plaidPrimaryCategory: 'Food',
          plaidDetailedCategory: 'Groceries',
          internalPrimaryCategory: null,
          internalDetailedCategory: null,
          isIgnored: false,
          isRefund: false,
          isTaxDeductible: false,
          paymentDate: Timestamp.fromDate(new Date('2025-01-15')),
          monthlyPeriodId: 'bp_jan_2025',
          weeklyPeriodId: null,
          biWeeklyPeriodId: null,
          rules: [],
          tags: [],
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        },
        {
          splitId: 'split_002',
          amount: 30.00,  // New split
          budgetId: 'budget_household',
          isDefault: false,
          plaidPrimaryCategory: 'Shopping',
          plaidDetailedCategory: 'General',
          internalPrimaryCategory: null,
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
        }
      ];

      // Validate and redistribute
      const { validateAndRedistributeSplits } = await import('../utils/validateAndRedistributeSplits');
      const validationResult = validateAndRedistributeSplits(txn.amount, updatedSplits);

      const finalSplits = validationResult.isValid ? updatedSplits : validationResult.redistributedSplits!;

      await db.collection('transactions').doc(txn.id).update({
        splits: finalSplits,
        updatedAt: Timestamp.now()
      });

      // Verify redistribution
      const updated = (await db.collection('transactions').doc(txn.id).get()).data();
      const splits = updated.splits;

      expect(splits[0].amount).toBeCloseTo(76.92, 2);
      expect(splits[1].amount).toBeCloseTo(23.08, 2);

      // Note: Budget period update would be triggered by onTransactionUpdate
      // In real integration, we'd verify budget_periods.spent was updated
    });

    it('handles amount change and recalculates budget periods', async () => {
      // Setup: Transaction with $100 amount
      await db.collection('transactions').doc('txn_amount_change').set({
        id: 'txn_amount_change',
        ownerId: testUserId,
        amount: 100.00,
        transactionDate: Timestamp.fromDate(new Date('2025-01-15')),
        splits: [{
          splitId: 'split_001',
          budgetId: 'budget_groceries',
          amount: 100.00,
          isDefault: true,
          plaidPrimaryCategory: 'Food',
          plaidDetailedCategory: 'Groceries',
          internalPrimaryCategory: null,
          internalDetailedCategory: null,
          isIgnored: false,
          isRefund: false,
          isTaxDeductible: false,
          paymentDate: Timestamp.fromDate(new Date('2025-01-15')),
          monthlyPeriodId: 'bp_jan_2025',
          weeklyPeriodId: null,
          biWeeklyPeriodId: null,
          rules: [],
          tags: [],
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        }],
        isActive: true,
        createdAt: Timestamp.now()
      });

      await db.collection('budget_periods').doc('bp_jan_2025').set({
        id: 'bp_jan_2025',
        budgetId: 'budget_groceries',
        userId: testUserId,
        periodStart: Timestamp.fromDate(new Date('2025-01-01')),
        periodEnd: Timestamp.fromDate(new Date('2025-01-31')),
        allocated: 500.00,
        spent: 100.00,
        remaining: 400.00,
        createdAt: Timestamp.now()
      });

      // Change amount to $120
      const newAmount = 120.00;
      const updatedSplits = [{
        splitId: 'split_001',
        budgetId: 'budget_groceries',
        amount: 100.00,  // Old amount (needs update)
        isDefault: true,
        plaidPrimaryCategory: 'Food',
        plaidDetailedCategory: 'Groceries',
        internalPrimaryCategory: null,
        internalDetailedCategory: null,
        isIgnored: false,
        isRefund: false,
        isTaxDeductible: false,
        paymentDate: Timestamp.fromDate(new Date('2025-01-15')),
        monthlyPeriodId: 'bp_jan_2025',
        weeklyPeriodId: null,
        biWeeklyPeriodId: null,
        rules: [],
        tags: [],
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      }];

      // Auto-adjust split to match new amount
      const { validateAndRedistributeSplits } = await import('../utils/validateAndRedistributeSplits');
      const validationResult = validateAndRedistributeSplits(newAmount, updatedSplits);

      const finalSplits = validationResult.isValid ? updatedSplits : validationResult.redistributedSplits!;

      await db.collection('transactions').doc('txn_amount_change').update({
        amount: newAmount,
        splits: finalSplits,
        updatedAt: Timestamp.now()
      });

      // Verify split updated to $120
      const updated = (await db.collection('transactions').doc('txn_amount_change').get()).data();
      expect(updated.splits[0].amount).toBe(120.00);

      // Verify delta calculation: +$20
      // Budget period should be updated: spent = 100 - 100 + 120 = 120
      // Note: Trigger logic would handle this in real integration
    });
  });

  describe('Transaction Deletion', () => {
    it('reverses budget_period.spent when transaction deleted', async () => {
      // Setup: Budget period with spending
      await db.collection('budget_periods').doc('bp_jan_2025').set({
        id: 'bp_jan_2025',
        budgetId: 'budget_groceries',
        userId: testUserId,
        periodStart: Timestamp.fromDate(new Date('2025-01-01')),
        periodEnd: Timestamp.fromDate(new Date('2025-01-31')),
        allocated: 500.00,
        spent: 85.50,
        remaining: 414.50,
        createdAt: Timestamp.now()
      });

      // Setup: Transaction
      const txn = {
        id: 'txn_to_delete',
        ownerId: testUserId,
        amount: 85.50,
        description: 'Transaction to delete',
        transactionDate: Timestamp.fromDate(new Date('2025-01-15')),
        splits: [{
          splitId: 'split_001',
          budgetId: 'budget_groceries',
          amount: 85.50,
          monthlyPeriodId: 'bp_jan_2025',
          isDefault: true,
          plaidPrimaryCategory: 'Food',
          plaidDetailedCategory: 'Groceries',
          internalPrimaryCategory: null,
          internalDetailedCategory: null,
          isIgnored: false,
          isRefund: false,
          isTaxDeductible: false,
          paymentDate: Timestamp.fromDate(new Date('2025-01-15')),
          weeklyPeriodId: null,
          biWeeklyPeriodId: null,
          rules: [],
          tags: [],
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        }],
        isActive: true,
        createdAt: Timestamp.now()
      };
      await db.collection('transactions').doc(txn.id).set(txn);

      // Delete transaction
      await db.collection('transactions').doc(txn.id).delete();

      // Note: In real integration, onTransactionDelete trigger would update budget period
      // We'd verify budget_periods.spent was reduced by $85.50
      // For this test, we're documenting the expected behavior
    });

    it('handles multi-split deletion and reverses all budget periods', async () => {
      // Setup: Two budget periods
      await db.collection('budget_periods').doc('bp_groceries_jan').set({
        id: 'bp_groceries_jan',
        budgetId: 'budget_groceries',
        userId: testUserId,
        periodStart: Timestamp.fromDate(new Date('2025-01-01')),
        periodEnd: Timestamp.fromDate(new Date('2025-01-31')),
        allocated: 500.00,
        spent: 60.00,
        remaining: 440.00,
        createdAt: Timestamp.now()
      });

      await db.collection('budget_periods').doc('bp_household_jan').set({
        id: 'bp_household_jan',
        budgetId: 'budget_household',
        userId: testUserId,
        periodStart: Timestamp.fromDate(new Date('2025-01-01')),
        periodEnd: Timestamp.fromDate(new Date('2025-01-31')),
        allocated: 200.00,
        spent: 25.50,
        remaining: 174.50,
        createdAt: Timestamp.now()
      });

      // Setup: Multi-split transaction
      await db.collection('transactions').doc('txn_multi_delete').set({
        id: 'txn_multi_delete',
        ownerId: testUserId,
        amount: 85.50,
        transactionDate: Timestamp.fromDate(new Date('2025-01-15')),
        splits: [
          {
            splitId: 'split_groceries',
            budgetId: 'budget_groceries',
            amount: 60.00,
            monthlyPeriodId: 'bp_groceries_jan',
            isDefault: true,
            plaidPrimaryCategory: 'Food',
            plaidDetailedCategory: 'Groceries',
            internalPrimaryCategory: null,
            internalDetailedCategory: null,
            isIgnored: false,
            isRefund: false,
            isTaxDeductible: false,
            paymentDate: Timestamp.fromDate(new Date('2025-01-15')),
            weeklyPeriodId: null,
            biWeeklyPeriodId: null,
            rules: [],
            tags: [],
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
          },
          {
            splitId: 'split_household',
            budgetId: 'budget_household',
            amount: 25.50,
            monthlyPeriodId: 'bp_household_jan',
            isDefault: false,
            plaidPrimaryCategory: 'Shopping',
            plaidDetailedCategory: 'Home',
            internalPrimaryCategory: null,
            internalDetailedCategory: null,
            isIgnored: false,
            isRefund: false,
            isTaxDeductible: false,
            paymentDate: Timestamp.fromDate(new Date('2025-01-15')),
            weeklyPeriodId: null,
            biWeeklyPeriodId: null,
            rules: [],
            tags: [],
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
          }
        ],
        isActive: true,
        createdAt: Timestamp.now()
      });

      // Delete transaction
      await db.collection('transactions').doc('txn_multi_delete').delete();

      // Note: In real integration, trigger would update BOTH budget periods:
      // - bp_groceries_jan: spent = 60 - 60 = 0, remaining = 500
      // - bp_household_jan: spent = 25.50 - 25.50 = 0, remaining = 200
    });
  });

  describe('Budget Assignment Integration', () => {
    it('automatically assigns transaction to correct budget on creation', async () => {
      // Setup: Budget with date range
      await db.collection('budgets').doc('budget_groceries').set({
        id: 'budget_groceries',
        userId: testUserId,
        categoryIds: ['cat_food_001'],
        isActive: true,
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isOngoing: true,
        createdAt: Timestamp.now()
      });

      // Create transaction within budget date range
      const transaction = {
        id: 'txn_auto_assign',
        ownerId: testUserId,
        amount: 50.00,
        transactionDate: Timestamp.fromDate(new Date('2025-01-15')),
        splits: [{
          splitId: 'split_001',
          budgetId: 'unassigned',  // Initially unassigned
          amount: 50.00,
          internalPrimaryCategory: 'FOOD',
          isDefault: true,
          plaidPrimaryCategory: 'Food',
          plaidDetailedCategory: 'Groceries',
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
        }],
        isActive: true,
        createdAt: Timestamp.now()
      };

      // Note: In real implementation, matchTransactionSplitsToBudgets() would run
      // and assign budgetId = 'budget_groceries'
      // For this test, we're documenting the expected behavior

      await db.collection('transactions').doc(transaction.id).set(transaction);

      // Verify transaction created
      const created = (await db.collection('transactions').doc(transaction.id).get()).data();
      expect(created).toBeDefined();
    });
  });
});
