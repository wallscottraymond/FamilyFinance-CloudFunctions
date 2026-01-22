import { reassignTransactionsFromDeletedBudget } from '../reassignTransactionsFromDeletedBudget';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp } from '@google-cloud/firestore';

/**
 * Test Suite for Budget Deletion Transaction Reassignment
 *
 * Tests the reassignTransactionsFromDeletedBudget utility with realistic data.
 * Following TDD approach: Tests written first, implementation follows.
 *
 * Key scenarios:
 * - Reassign all transactions from deleted budget to date-matched budgets
 * - Fallback to "Everything Else" budget when no date match
 * - Batch processing with 500-doc Firestore limit
 * - Multi-split transactions (only reassign splits from deleted budget)
 */

describe('reassignTransactionsFromDeletedBudget', () => {
  let testEnv: RulesTestEnvironment;
  let db: any;
  const testUserId = 'user_test_001';
  const deletedBudgetId = 'budget_to_delete';

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'test-project-budget-deletion',
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

  describe('Basic Reassignment', () => {
    it('reassigns all transactions from deleted budget to date-matched budgets', async () => {
      // Setup: Create realistic budgets
      const deletedBudget = {
        id: deletedBudgetId,
        userId: testUserId,
        groupIds: [],
        name: 'Old Transportation Budget',
        amount: 200.00,
        categoryIds: ['cat_transportation_001'],
        period: 'MONTHLY',
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isOngoing: true,
        isActive: false,  // Soft deleted
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };

      const newMatchingBudget = {
        id: 'budget_transportation_new',
        userId: testUserId,
        groupIds: [],
        name: 'New Transportation Budget',
        amount: 250.00,
        categoryIds: ['cat_transportation_001'],
        period: 'MONTHLY',
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isOngoing: true,
        isActive: true,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };

      await db.collection('budgets').doc(deletedBudget.id).set(deletedBudget);
      await db.collection('budgets').doc(newMatchingBudget.id).set(newMatchingBudget);

      // Create 10 realistic transactions assigned to deleted budget
      const transactions = [];
      for (let i = 0; i < 10; i++) {
        const txn = {
          id: `txn_test_${i}`,
          ownerId: testUserId,
          groupIds: [],
          transactionDate: Timestamp.fromDate(new Date(`2025-01-${(i + 1).toString().padStart(2, '0')}`)),
          amount: 25.00,
          description: `Gas Station ${i}`,
          status: 'approved',
          type: 'expense',
          splits: [
            {
              splitId: `split_${i}`,
              budgetId: deletedBudgetId,  // Assigned to deleted budget
              amount: 25.00,
              description: 'Gas',
              isDefault: true,
              monthlyPeriodId: 'bp_jan_2025_old',
              weeklyPeriodId: null,
              biWeeklyPeriodId: null,
              outflowId: null,
              plaidPrimaryCategory: 'Transportation',
              plaidDetailedCategory: 'Gas Stations',
              internalPrimaryCategory: 'TRANSPORTATION',
              internalDetailedCategory: null,
              isIgnored: false,
              isRefund: false,
              isTaxDeductible: false,
              ignoredReason: null,
              refundReason: null,
              paymentDate: Timestamp.fromDate(new Date(`2025-01-${(i + 1).toString().padStart(2, '0')}`)),
              rules: [],
              tags: ['gas'],
              createdAt: Timestamp.now(),
              updatedAt: Timestamp.now()
            }
          ],
          isActive: true,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        };
        transactions.push(txn);
        await db.collection('transactions').doc(txn.id).set(txn);
      }

      // Execute reassignment
      const result = await reassignTransactionsFromDeletedBudget(deletedBudgetId, testUserId);

      // Verify results
      expect(result.transactionsReassigned).toBe(10);
      expect(result.budgetAssignments['budget_transportation_new']).toBe(10);

      // Verify transactions updated in Firestore
      const updatedTransactions = await db.collection('transactions')
        .where('ownerId', '==', testUserId)
        .get();

      updatedTransactions.forEach((doc: any) => {
        const data = doc.data();
        expect(data.splits[0].budgetId).toBe('budget_transportation_new');
        expect(data.splits[0].budgetId).not.toBe(deletedBudgetId);
      });
    });

    it('handles transactions with no splits gracefully', async () => {
      // Create budget
      await db.collection('budgets').doc(deletedBudgetId).set({
        id: deletedBudgetId,
        userId: testUserId,
        isActive: false
      });

      // Create transaction without splits array
      await db.collection('transactions').doc('txn_no_splits').set({
        id: 'txn_no_splits',
        ownerId: testUserId,
        amount: 50.00,
        // splits: [],  // Intentionally missing
        isActive: true
      });

      const result = await reassignTransactionsFromDeletedBudget(deletedBudgetId, testUserId);

      expect(result.transactionsReassigned).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Fallback to "Everything Else"', () => {
    it('assigns to Everything Else when no date-matched budget exists', async () => {
      // Setup budgets with non-matching dates
      const deletedBudget = {
        id: deletedBudgetId,
        userId: testUserId,
        categoryIds: ['cat_food_001'],
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isActive: false,
        createdAt: Timestamp.now()
      };

      const everythingElseBudget = {
        id: 'budget_everything_else',
        userId: testUserId,
        name: 'Everything Else',
        amount: 0,
        categoryIds: [],
        isSystemEverythingElse: true,
        isOngoing: true,
        isActive: true,
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        createdAt: Timestamp.now()
      };

      await db.collection('budgets').doc(deletedBudget.id).set(deletedBudget);
      await db.collection('budgets').doc(everythingElseBudget.id).set(everythingElseBudget);

      // Create transaction on future date (no matching budget)
      const txn = {
        id: 'txn_future',
        ownerId: testUserId,
        amount: 50.00,
        transactionDate: Timestamp.fromDate(new Date('2025-12-25')),  // Future date
        splits: [{
          splitId: 'split_future',
          budgetId: deletedBudgetId,
          amount: 50.00,
          isDefault: true,
          plaidPrimaryCategory: 'Food',
          plaidDetailedCategory: 'Groceries',
          internalPrimaryCategory: null,
          internalDetailedCategory: null,
          isIgnored: false,
          isRefund: false,
          isTaxDeductible: false,
          paymentDate: Timestamp.fromDate(new Date('2025-12-25')),
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
      await db.collection('transactions').doc(txn.id).set(txn);

      const result = await reassignTransactionsFromDeletedBudget(deletedBudgetId, testUserId);

      expect(result.budgetAssignments['budget_everything_else']).toBe(1);

      // Verify transaction updated
      const updatedTxn = (await db.collection('transactions').doc('txn_future').get()).data();
      expect(updatedTxn.splits[0].budgetId).toBe('budget_everything_else');
    });

    it('marks splits as unassigned when no Everything Else budget exists', async () => {
      // Setup: deleted budget but NO "Everything Else" budget
      await db.collection('budgets').doc(deletedBudgetId).set({
        id: deletedBudgetId,
        userId: testUserId,
        isActive: false,
        createdAt: Timestamp.now()
      });

      // Create transaction
      await db.collection('transactions').doc('txn_orphan').set({
        id: 'txn_orphan',
        ownerId: testUserId,
        amount: 50.00,
        transactionDate: Timestamp.fromDate(new Date('2025-01-15')),
        splits: [{
          splitId: 'split_orphan',
          budgetId: deletedBudgetId,
          amount: 50.00,
          isDefault: true,
          plaidPrimaryCategory: 'Food',
          plaidDetailedCategory: 'Groceries',
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
        }],
        isActive: true,
        createdAt: Timestamp.now()
      });

      const result = await reassignTransactionsFromDeletedBudget(deletedBudgetId, testUserId);

      expect(result.budgetAssignments['unassigned']).toBe(1);

      // Verify transaction marked as unassigned
      const updatedTxn = (await db.collection('transactions').doc('txn_orphan').get()).data();
      expect(updatedTxn.splits[0].budgetId).toBe('unassigned');
    });
  });

  describe('Batch Processing', () => {
    it('handles 600 transactions with proper batching (500-doc limit)', async () => {
      // Setup budgets
      await db.collection('budgets').doc(deletedBudgetId).set({
        id: deletedBudgetId,
        userId: testUserId,
        isActive: false,
        createdAt: Timestamp.now()
      });

      await db.collection('budgets').doc('budget_new').set({
        id: 'budget_new',
        userId: testUserId,
        isActive: true,
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isOngoing: true,
        createdAt: Timestamp.now()
      });

      // Create 600 transactions
      const batchSize = 100;
      for (let batch = 0; batch < 6; batch++) {
        const promises = [];
        for (let i = 0; i < batchSize; i++) {
          const txnId = `txn_batch_${batch * batchSize + i}`;
          promises.push(
            db.collection('transactions').doc(txnId).set({
              id: txnId,
              ownerId: testUserId,
              transactionDate: Timestamp.fromDate(new Date('2025-01-15')),
              splits: [{
                splitId: `split_${batch * batchSize + i}`,
                budgetId: deletedBudgetId,
                amount: 10.00,
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
              }],
              isActive: true,
              createdAt: Timestamp.now()
            })
          );
        }
        await Promise.all(promises);
      }

      const result = await reassignTransactionsFromDeletedBudget(deletedBudgetId, testUserId);

      expect(result.transactionsReassigned).toBe(600);
      // Verify batching worked (should use 2 batches: 500 + 100)
      expect(result.batchCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Multi-Split Transactions', () => {
    it('only reassigns splits from deleted budget, preserves other splits', async () => {
      // Setup budgets
      await db.collection('budgets').doc(deletedBudgetId).set({
        id: deletedBudgetId,
        userId: testUserId,
        isActive: false,
        createdAt: Timestamp.now()
      });

      await db.collection('budgets').doc('budget_new').set({
        id: 'budget_new',
        userId: testUserId,
        isActive: true,
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isOngoing: true,
        createdAt: Timestamp.now()
      });

      await db.collection('budgets').doc('budget_other').set({
        id: 'budget_other',
        userId: testUserId,
        isActive: true,
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isOngoing: true,
        createdAt: Timestamp.now()
      });

      // Create multi-split transaction
      const txn = {
        id: 'txn_multi_split',
        ownerId: testUserId,
        amount: 100.00,
        transactionDate: Timestamp.fromDate(new Date('2025-01-15')),
        splits: [
          {
            splitId: 'split_001',
            budgetId: deletedBudgetId,  // This one gets reassigned
            amount: 60.00,
            isDefault: true,
            plaidPrimaryCategory: 'Food',
            plaidDetailedCategory: 'Groceries',
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
            budgetId: 'budget_other',  // This one stays
            amount: 40.00,
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
      await db.collection('transactions').doc(txn.id).set(txn);

      await reassignTransactionsFromDeletedBudget(deletedBudgetId, testUserId);

      const updatedTxn = (await db.collection('transactions').doc(txn.id).get()).data();
      const splits = updatedTxn.splits;

      expect(splits[0].budgetId).not.toBe(deletedBudgetId);  // Reassigned
      expect(splits[1].budgetId).toBe('budget_other');  // Unchanged
    });

    it('handles all splits from deleted budget in same transaction', async () => {
      // Setup budgets
      await db.collection('budgets').doc(deletedBudgetId).set({
        id: deletedBudgetId,
        userId: testUserId,
        isActive: false,
        createdAt: Timestamp.now()
      });

      await db.collection('budgets').doc('budget_new').set({
        id: 'budget_new',
        userId: testUserId,
        isActive: true,
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isOngoing: true,
        createdAt: Timestamp.now()
      });

      // Create transaction with all splits from deleted budget
      await db.collection('transactions').doc('txn_all_deleted').set({
        id: 'txn_all_deleted',
        ownerId: testUserId,
        amount: 100.00,
        transactionDate: Timestamp.fromDate(new Date('2025-01-15')),
        splits: [
          {
            splitId: 'split_001',
            budgetId: deletedBudgetId,
            amount: 60.00,
            isDefault: true,
            plaidPrimaryCategory: 'Food',
            plaidDetailedCategory: 'Groceries',
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
            budgetId: deletedBudgetId,
            amount: 40.00,
            isDefault: false,
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
          }
        ],
        isActive: true,
        createdAt: Timestamp.now()
      });

      await reassignTransactionsFromDeletedBudget(deletedBudgetId, testUserId);

      const updatedTxn = (await db.collection('transactions').doc('txn_all_deleted').get()).data();

      // Both splits should be reassigned
      expect(updatedTxn.splits[0].budgetId).not.toBe(deletedBudgetId);
      expect(updatedTxn.splits[1].budgetId).not.toBe(deletedBudgetId);
    });
  });

  describe('Error Handling', () => {
    it('returns error when deleted budget does not exist', async () => {
      const result = await reassignTransactionsFromDeletedBudget('nonexistent_budget', testUserId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Budget not found');
    });

    it('returns error when budget is not deleted (isActive=true)', async () => {
      await db.collection('budgets').doc(deletedBudgetId).set({
        id: deletedBudgetId,
        userId: testUserId,
        isActive: true,  // Not deleted!
        createdAt: Timestamp.now()
      });

      const result = await reassignTransactionsFromDeletedBudget(deletedBudgetId, testUserId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Budget is not deleted');
    });

    it('handles partial failures gracefully', async () => {
      // Setup: deleted budget + new budget
      await db.collection('budgets').doc(deletedBudgetId).set({
        id: deletedBudgetId,
        userId: testUserId,
        isActive: false,
        createdAt: Timestamp.now()
      });

      await db.collection('budgets').doc('budget_new').set({
        id: 'budget_new',
        userId: testUserId,
        isActive: true,
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isOngoing: true,
        createdAt: Timestamp.now()
      });

      // Create valid transaction
      await db.collection('transactions').doc('txn_valid').set({
        id: 'txn_valid',
        ownerId: testUserId,
        transactionDate: Timestamp.fromDate(new Date('2025-01-15')),
        splits: [{
          splitId: 'split_valid',
          budgetId: deletedBudgetId,
          amount: 50.00,
          isDefault: true,
          plaidPrimaryCategory: 'Food',
          plaidDetailedCategory: 'Groceries',
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
        }],
        isActive: true,
        createdAt: Timestamp.now()
      });

      // Create invalid transaction (missing critical fields)
      await db.collection('transactions').doc('txn_invalid').set({
        id: 'txn_invalid',
        ownerId: testUserId,
        // Missing transactionDate
        splits: [{
          splitId: 'split_invalid',
          budgetId: deletedBudgetId,
          amount: 50.00
          // Missing many required fields
        }],
        isActive: true
      });

      const result = await reassignTransactionsFromDeletedBudget(deletedBudgetId, testUserId);

      // Should succeed partially
      expect(result.transactionsReassigned).toBe(1);  // Only valid one
      expect(result.errors).toHaveLength(1);  // One error for invalid transaction
      expect(result.errors[0]).toContain('txn_invalid');
    });
  });
});
