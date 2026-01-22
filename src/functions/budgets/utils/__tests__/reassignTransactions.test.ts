import { reassignTransactionsForBudget, ReassignmentStats } from '../reassignTransactions';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp } from '@google-cloud/firestore';

/**
 * Test Suite for Enhanced Category Reassignment
 *
 * Tests the reassignTransactionsForBudget utility with enhanced logic for:
 * - Category additions (pick up unassigned transactions)
 * - Category removals (FULL transaction re-evaluation, not just removed category)
 *
 * Following TDD approach: Tests written first, implementation follows.
 *
 * Key requirement: When categories are REMOVED, re-evaluate ALL splits in affected
 * transactions, not just splits matching the removed category.
 */

describe('reassignTransactionsForBudget - Enhanced Category Logic', () => {
  let testEnv: RulesTestEnvironment;
  let db: any;
  const testUserId = 'user_test_001';

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'test-project-category-reassignment',
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

  describe('Category Additions', () => {
    it('picks up unassigned transactions matching new categories', async () => {
      // Setup: Budget initially has only 'Food' category
      const budget = {
        id: 'budget_combo',
        userId: testUserId,
        categoryIds: ['cat_food_001'],  // Initial categories
        isActive: true,
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isOngoing: true,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };
      await db.collection('budgets').doc(budget.id).set(budget);

      // Create "Everything Else" budget
      const everythingElseBudget = {
        id: 'budget_everything_else',
        userId: testUserId,
        categoryIds: [],
        isSystemEverythingElse: true,
        isActive: true,
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isOngoing: true,
        createdAt: Timestamp.now()
      };
      await db.collection('budgets').doc(everythingElseBudget.id).set(everythingElseBudget);

      // Create transactions with Transportation category (currently unassigned to specific budget)
      const transportationTxns = [
        {
          id: 'txn_gas_001',
          ownerId: testUserId,
          transactionDate: Timestamp.fromDate(new Date('2025-01-10')),
          amount: 50.00,
          splits: [{
            splitId: 'split_gas',
            budgetId: 'budget_everything_else',  // Currently in "Everything Else"
            amount: 50.00,
            internalPrimaryCategory: 'TRANSPORTATION',
            isDefault: true,
            plaidPrimaryCategory: 'Transportation',
            plaidDetailedCategory: 'Gas Stations',
            internalDetailedCategory: null,
            isIgnored: false,
            isRefund: false,
            isTaxDeductible: false,
            paymentDate: Timestamp.fromDate(new Date('2025-01-10')),
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
        }
      ];

      for (const txn of transportationTxns) {
        await db.collection('transactions').doc(txn.id).set(txn);
      }

      // User adds 'Transportation' category to budget
      await db.collection('budgets').doc(budget.id).update({
        categoryIds: ['cat_food_001', 'cat_transportation_001']
      });

      // Execute reassignment with category additions
      const result = await reassignTransactionsForBudget(
        budget.id,
        testUserId,
        {
          categoriesAdded: ['cat_transportation_001'],
          categoriesRemoved: []
        }
      ) as ReassignmentStats;

      expect(result.transactionsReassigned).toBe(1);

      // Verify transaction now assigned to budget_combo
      const updatedTxn = (await db.collection('transactions').doc('txn_gas_001').get()).data();
      expect(updatedTxn.splits[0].budgetId).toBe('budget_combo');
    });

    it('does not reassign transactions already in other specific budgets', async () => {
      // Setup budgets
      const budget = {
        id: 'budget_combo',
        userId: testUserId,
        categoryIds: ['cat_food_001'],
        isActive: true,
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isOngoing: true,
        createdAt: Timestamp.now()
      };
      await db.collection('budgets').doc(budget.id).set(budget);

      const otherBudget = {
        id: 'budget_transportation',
        userId: testUserId,
        categoryIds: ['cat_transportation_001'],
        isActive: true,
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isOngoing: true,
        createdAt: Timestamp.now()
      };
      await db.collection('budgets').doc(otherBudget.id).set(otherBudget);

      // Create transaction already in transportation budget
      await db.collection('transactions').doc('txn_gas').set({
        id: 'txn_gas',
        ownerId: testUserId,
        transactionDate: Timestamp.fromDate(new Date('2025-01-10')),
        amount: 50.00,
        splits: [{
          splitId: 'split_gas',
          budgetId: 'budget_transportation',  // Already in specific budget
          amount: 50.00,
          internalPrimaryCategory: 'TRANSPORTATION',
          isDefault: true,
          plaidPrimaryCategory: 'Transportation',
          plaidDetailedCategory: 'Gas Stations',
          internalDetailedCategory: null,
          isIgnored: false,
          isRefund: false,
          isTaxDeductible: false,
          paymentDate: Timestamp.fromDate(new Date('2025-01-10')),
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

      // User adds Transportation to budget_combo
      await db.collection('budgets').doc(budget.id).update({
        categoryIds: ['cat_food_001', 'cat_transportation_001']
      });

      const result = await reassignTransactionsForBudget(
        budget.id,
        testUserId,
        {
          categoriesAdded: ['cat_transportation_001'],
          categoriesRemoved: []
        }
      ) as ReassignmentStats;

      // Should NOT reassign (already in specific budget)
      expect(result.transactionsReassigned).toBe(0);

      const txn = (await db.collection('transactions').doc('txn_gas').get()).data();
      expect(txn.splits[0].budgetId).toBe('budget_transportation');  // Unchanged
    });
  });

  describe('Category Removals - Full Re-evaluation', () => {
    it('re-evaluates ALL splits in affected transactions, not just removed category', async () => {
      // Setup: Multi-split transaction
      const budget = {
        id: 'budget_groceries',
        userId: testUserId,
        categoryIds: ['cat_food_001', 'cat_household_001'],  // Food + Household
        isActive: true,
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isOngoing: true,
        createdAt: Timestamp.now()
      };
      await db.collection('budgets').doc(budget.id).set(budget);

      // Create separate household budget
      const householdBudget = {
        id: 'budget_household_separate',
        userId: testUserId,
        categoryIds: ['cat_household_001'],
        isActive: true,
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isOngoing: true,
        createdAt: Timestamp.now()
      };
      await db.collection('budgets').doc(householdBudget.id).set(householdBudget);

      // Create multi-split transaction (Walmart: food + household)
      const txn = {
        id: 'txn_walmart_multi',
        ownerId: testUserId,
        amount: 100.00,
        transactionDate: Timestamp.fromDate(new Date('2025-01-15')),
        splits: [
          {
            splitId: 'split_food',
            budgetId: 'budget_groceries',  // Food category
            amount: 60.00,
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
          },
          {
            splitId: 'split_household',
            budgetId: 'budget_groceries',  // Household category (to be removed)
            amount: 40.00,
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
        createdAt: Timestamp.now()
      };
      await db.collection('transactions').doc(txn.id).set(txn);

      // User removes 'Household' category from Groceries budget
      await db.collection('budgets').doc(budget.id).update({
        categoryIds: ['cat_food_001']  // Only food now
      });

      const result = await reassignTransactionsForBudget(
        budget.id,
        testUserId,
        {
          categoriesAdded: [],
          categoriesRemoved: ['cat_household_001']
        }
      ) as ReassignmentStats;

      expect(result.transactionsReassigned).toBe(1);

      // Verify ENTIRE transaction was re-evaluated
      const updatedTxn = (await db.collection('transactions').doc(txn.id).get()).data();
      const splits = updatedTxn.splits;

      // Food split should stay with Groceries budget
      expect(splits[0].budgetId).toBe('budget_groceries');

      // Household split should be reassigned to separate household budget
      expect(splits[1].budgetId).toBe('budget_household_separate');
    });

    it('re-evaluates transaction even when only one split has removed category', async () => {
      // Setup budgets
      const budget = {
        id: 'budget_combined',
        userId: testUserId,
        categoryIds: ['cat_food_001', 'cat_entertainment_001'],
        isActive: true,
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isOngoing: true,
        createdAt: Timestamp.now()
      };
      await db.collection('budgets').doc(budget.id).set(budget);

      const entertainmentBudget = {
        id: 'budget_entertainment',
        userId: testUserId,
        categoryIds: ['cat_entertainment_001'],
        isActive: true,
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isOngoing: true,
        createdAt: Timestamp.now()
      };
      await db.collection('budgets').doc(entertainmentBudget.id).set(entertainmentBudget);

      // Create transaction with 3 splits
      await db.collection('transactions').doc('txn_mixed').set({
        id: 'txn_mixed',
        ownerId: testUserId,
        amount: 150.00,
        transactionDate: Timestamp.fromDate(new Date('2025-01-15')),
        splits: [
          {
            splitId: 'split_food',
            budgetId: 'budget_combined',
            amount: 50.00,
            internalPrimaryCategory: 'FOOD',
            isDefault: true,
            plaidPrimaryCategory: 'Food',
            plaidDetailedCategory: 'Restaurants',
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
            splitId: 'split_entertainment',
            budgetId: 'budget_combined',
            amount: 100.00,
            internalPrimaryCategory: 'ENTERTAINMENT',  // This category will be removed
            isDefault: false,
            plaidPrimaryCategory: 'Entertainment',
            plaidDetailedCategory: 'Movies',
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

      // Remove entertainment category
      await db.collection('budgets').doc(budget.id).update({
        categoryIds: ['cat_food_001']
      });

      const result = await reassignTransactionsForBudget(
        budget.id,
        testUserId,
        {
          categoriesAdded: [],
          categoriesRemoved: ['cat_entertainment_001']
        }
      ) as ReassignmentStats;

      expect(result.transactionsReassigned).toBe(1);

      const updatedTxn = (await db.collection('transactions').doc('txn_mixed').get()).data();

      // Food split stays
      expect(updatedTxn.splits[0].budgetId).toBe('budget_combined');

      // Entertainment split reassigned to specific budget
      expect(updatedTxn.splits[1].budgetId).toBe('budget_entertainment');
    });

    it('handles cascading reassignments when multiple budgets overlap', async () => {
      // Setup: Budget A has [Food, Entertainment]
      // Budget B has [Food]
      // Budget C has [Entertainment]
      // Remove Entertainment from A → splits should go to C

      const budgetA = {
        id: 'budget_a',
        userId: testUserId,
        categoryIds: ['cat_food_001', 'cat_entertainment_001'],
        isActive: true,
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isOngoing: true,
        createdAt: Timestamp.now()
      };
      await db.collection('budgets').doc(budgetA.id).set(budgetA);

      const budgetB = {
        id: 'budget_b',
        userId: testUserId,
        categoryIds: ['cat_food_001'],
        isActive: true,
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isOngoing: true,
        createdAt: Timestamp.now()
      };
      await db.collection('budgets').doc(budgetB.id).set(budgetB);

      const budgetC = {
        id: 'budget_c',
        userId: testUserId,
        categoryIds: ['cat_entertainment_001'],
        isActive: true,
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isOngoing: true,
        createdAt: Timestamp.now()
      };
      await db.collection('budgets').doc(budgetC.id).set(budgetC);

      // Transaction with entertainment split in budget A
      await db.collection('transactions').doc('txn_cascade').set({
        id: 'txn_cascade',
        ownerId: testUserId,
        amount: 75.00,
        transactionDate: Timestamp.fromDate(new Date('2025-01-15')),
        splits: [{
          splitId: 'split_entertainment',
          budgetId: 'budget_a',
          amount: 75.00,
          internalPrimaryCategory: 'ENTERTAINMENT',
          isDefault: true,
          plaidPrimaryCategory: 'Entertainment',
          plaidDetailedCategory: 'Movies',
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

      // Remove entertainment from budget A
      await db.collection('budgets').doc(budgetA.id).update({
        categoryIds: ['cat_food_001']
      });

      const result = await reassignTransactionsForBudget(
        budgetA.id,
        testUserId,
        {
          categoriesAdded: [],
          categoriesRemoved: ['cat_entertainment_001']
        }
      ) as ReassignmentStats;

      expect(result.transactionsReassigned).toBe(1);

      const updatedTxn = (await db.collection('transactions').doc('txn_cascade').get()).data();
      expect(updatedTxn.splits[0].budgetId).toBe('budget_c');  // Reassigned to budget C
    });
  });

  describe('Error Handling', () => {
    it('returns error when budget does not exist', async () => {
      const result = await reassignTransactionsForBudget(
        'nonexistent_budget',
        testUserId,
        {
          categoriesAdded: ['cat_food_001'],
          categoriesRemoved: []
        }
      ) as ReassignmentStats;

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Budget not found');
    });

    it('handles empty category changes gracefully', async () => {
      const budget = {
        id: 'budget_test',
        userId: testUserId,
        categoryIds: ['cat_food_001'],
        isActive: true,
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isOngoing: true,
        createdAt: Timestamp.now()
      };
      await db.collection('budgets').doc(budget.id).set(budget);

      const result = await reassignTransactionsForBudget(
        budget.id,
        testUserId,
        {
          categoriesAdded: [],
          categoriesRemoved: []
        }
      ) as ReassignmentStats;

      expect(result.success).toBe(true);
      expect(result.transactionsReassigned).toBe(0);
    });

    it('continues on partial failures', async () => {
      const budget = {
        id: 'budget_partial',
        userId: testUserId,
        categoryIds: ['cat_food_001'],
        isActive: true,
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isOngoing: true,
        createdAt: Timestamp.now()
      };
      await db.collection('budgets').doc(budget.id).set(budget);

      // Create valid transaction
      await db.collection('transactions').doc('txn_valid').set({
        id: 'txn_valid',
        ownerId: testUserId,
        transactionDate: Timestamp.fromDate(new Date('2025-01-15')),
        amount: 50.00,
        splits: [{
          splitId: 'split_valid',
          budgetId: 'budget_partial',
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
      });

      // Create invalid transaction (missing date)
      await db.collection('transactions').doc('txn_invalid').set({
        id: 'txn_invalid',
        ownerId: testUserId,
        // Missing transactionDate
        splits: [{
          splitId: 'split_invalid',
          budgetId: 'budget_partial',
          amount: 50.00
        }],
        isActive: true
      });

      const result = await reassignTransactionsForBudget(
        budget.id,
        testUserId,
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
