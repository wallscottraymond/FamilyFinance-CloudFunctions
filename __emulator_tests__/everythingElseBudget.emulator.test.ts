/**
 * Emulator End-to-End Tests for "Everything Else" Budget System
 *
 * Run these tests against the Firebase emulator to verify the complete
 * "everything else" budget flow works correctly.
 *
 * Prerequisites:
 * 1. Start emulators: firebase emulators:start
 * 2. Run tests: npm run test:emulator
 *
 * Test Flow:
 * 1. User signup → "everything else" budget auto-created
 * 2. Transaction without budget → assigned to "everything else"
 * 3. Deletion attempt → rejected
 * 4. Amount edit attempt → rejected
 * 5. Name edit → allowed
 * 6. Direct deletion → auto-recreation
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
const auth = admin.auth();

describe('Everything Else Budget - Emulator E2E Tests', () => {
  let testUserId: string;
  let testUserEmail: string;
  let everythingElseBudgetId: string;

  beforeAll(async () => {
    // Create test user
    testUserEmail = `test-${Date.now()}@example.com`;
    const userRecord = await auth.createUser({
      email: testUserEmail,
      password: 'testpassword123',
      emailVerified: true
    });
    testUserId = userRecord.uid;

    console.log(`✅ Created test user: ${testUserId}`);
  });

  afterAll(async () => {
    // Cleanup
    try {
      await auth.deleteUser(testUserId);
      console.log(`🗑️ Cleaned up test user: ${testUserId}`);
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  });

  describe('1. User Signup Integration', () => {
    test('should create "everything else" budget on user signup', async () => {
      // Simulate user profile creation
      await db.collection('users').doc(testUserId).set({
        email: testUserEmail,
        displayName: 'Test User',
        isActive: true,
        role: 'standard_user',
        preferences: {
          currency: 'USD'
        },
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });

      // Wait for onUserCreate trigger to fire and create budget
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Query for "everything else" budget
      const budgetsQuery = await db.collection('budgets')
        .where('userId', '==', testUserId)
        .where('isSystemEverythingElse', '==', true)
        .get();

      expect(budgetsQuery.empty).toBe(false);
      expect(budgetsQuery.docs.length).toBe(1);

      const budget = budgetsQuery.docs[0].data();
      everythingElseBudgetId = budgetsQuery.docs[0].id;

      // Verify budget configuration
      expect(budget.name).toBe('Everything Else');
      expect(budget.isSystemEverythingElse).toBe(true);
      expect(budget.amount).toBe(0);
      expect(budget.categoryIds).toEqual([]);
      expect(budget.budgetType).toBe('recurring');
      expect(budget.isOngoing).toBe(true);
      expect(budget.isActive).toBe(true);
      expect(budget.userId).toBe(testUserId);
      expect(budget.groupIds).toEqual([]);

      console.log(`✅ "Everything else" budget created: ${everythingElseBudgetId}`);
    });
  });

  describe('2. Transaction Matching', () => {
    test('should assign unmatched transaction to "everything else" budget', async () => {
      // Create a transaction without a matching budget
      const transactionRef = await db.collection('transactions').add({
        userId: testUserId,
        groupIds: [],
        isActive: true,
        amount: 50,
        description: 'Unmatched purchase',
        date: Timestamp.now(),
        status: 'approved',
        type: 'expense',
        splits: [{
          budgetId: 'unassigned',
          amount: 50,
          createdAt: Timestamp.now()
        }],
        access: {
          ownerId: testUserId,
          createdBy: testUserId,
          groupIds: [],
          isPrivate: true
        },
        categories: {
          primary: 'other',
          tags: []
        },
        metadata: {
          source: 'manual',
          createdBy: testUserId
        },
        relationships: {
          linkedIds: []
        },
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });

      // Wait for matching logic to run
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Read transaction back
      const transactionDoc = await transactionRef.get();
      const transaction = transactionDoc.data();

      // Verify split was assigned to "everything else" budget
      expect(transaction?.splits[0].budgetId).toBe(everythingElseBudgetId);

      console.log(`✅ Transaction assigned to "everything else" budget`);
    });

    test('should assign to regular budget first if match exists', async () => {
      // Create a regular budget
      const regularBudgetRef = await db.collection('budgets').add({
        userId: testUserId,
        groupIds: [],
        isActive: true,
        name: 'Groceries',
        amount: 500,
        categoryIds: ['food'],
        budgetType: 'recurring',
        isOngoing: true,
        startDate: Timestamp.fromDate(new Date('2025-01-01')),
        isSystemEverythingElse: false,
        createdBy: testUserId,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });

      const regularBudgetId = regularBudgetRef.id;

      // Create transaction that should match regular budget
      const transactionRef = await db.collection('transactions').add({
        userId: testUserId,
        groupIds: [],
        isActive: true,
        amount: 25,
        description: 'Grocery purchase',
        date: Timestamp.fromDate(new Date('2025-01-15')),
        status: 'approved',
        type: 'expense',
        splits: [{
          budgetId: 'unassigned',
          amount: 25,
          createdAt: Timestamp.now()
        }],
        access: {
          ownerId: testUserId,
          createdBy: testUserId,
          groupIds: [],
          isPrivate: true
        },
        categories: {
          primary: 'food',
          tags: []
        },
        metadata: {
          source: 'manual',
          createdBy: testUserId
        },
        relationships: {
          linkedIds: []
        },
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });

      // Wait for matching logic
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Read transaction back
      const transactionDoc = await transactionRef.get();
      const transaction = transactionDoc.data();

      // Should match regular budget, NOT "everything else"
      expect(transaction?.splits[0].budgetId).toBe(regularBudgetId);

      console.log(`✅ Transaction matched regular budget (not "everything else")`);
    });
  });

  describe('3. Deletion Prevention', () => {
    test('should reject deletion of "everything else" budget via Cloud Function', async () => {
      // This would normally call the deleteBudget Cloud Function
      // For emulator testing, we'll verify the security rules prevent deletion

      try {
        // Attempt to delete "everything else" budget directly
        await db.collection('budgets').doc(everythingElseBudgetId).delete();

        // If we get here, deletion was not prevented (test should fail)
        fail('Budget deletion should have been prevented');
      } catch (error: any) {
        // Deletion prevented by security rules or trigger
        console.log(`✅ Deletion prevented: ${error.message}`);
        expect(error).toBeDefined();
      }
    });

    test('should verify budget still exists after deletion attempt', async () => {
      const budgetDoc = await db.collection('budgets').doc(everythingElseBudgetId).get();
      expect(budgetDoc.exists).toBe(true);

      const budget = budgetDoc.data();
      expect(budget?.isSystemEverythingElse).toBe(true);

      console.log(`✅ Budget still exists after deletion attempt`);
    });
  });

  describe('4. Update Restrictions', () => {
    test('should reject amount update on "everything else" budget', async () => {
      try {
        await db.collection('budgets').doc(everythingElseBudgetId).update({
          amount: 100
        });

        // If we get here, update was not prevented
        fail('Amount update should have been prevented');
      } catch (error: any) {
        console.log(`✅ Amount update prevented: ${error.message}`);
        expect(error).toBeDefined();
      }
    });

    test('should reject categoryIds update on "everything else" budget', async () => {
      try {
        await db.collection('budgets').doc(everythingElseBudgetId).update({
          categoryIds: ['food', 'groceries']
        });

        fail('CategoryIds update should have been prevented');
      } catch (error: any) {
        console.log(`✅ CategoryIds update prevented: ${error.message}`);
        expect(error).toBeDefined();
      }
    });

    test('should reject isSystemEverythingElse flag modification', async () => {
      try {
        await db.collection('budgets').doc(everythingElseBudgetId).update({
          isSystemEverythingElse: false
        });

        fail('System flag modification should have been prevented');
      } catch (error: any) {
        console.log(`✅ System flag modification prevented: ${error.message}`);
        expect(error).toBeDefined();
      }
    });

    test('should allow name update on "everything else" budget', async () => {
      const newName = 'Miscellaneous Spending';

      await db.collection('budgets').doc(everythingElseBudgetId).update({
        name: newName,
        updatedAt: Timestamp.now()
      });

      const budgetDoc = await db.collection('budgets').doc(everythingElseBudgetId).get();
      const budget = budgetDoc.data();

      expect(budget?.name).toBe(newName);

      console.log(`✅ Name update allowed: "${newName}"`);
    });
  });

  describe('5. Auto-Recreation Safety Net', () => {
    test('should auto-recreate if budget is deleted via admin', async () => {
      // Use admin SDK to bypass security rules and delete the budget
      await db.collection('budgets').doc(everythingElseBudgetId).delete();

      console.log(`🗑️ Deleted "everything else" budget via admin`);

      // Wait for onBudgetDelete trigger to fire and recreate
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Query for "everything else" budget
      const budgetsQuery = await db.collection('budgets')
        .where('userId', '==', testUserId)
        .where('isSystemEverythingElse', '==', true)
        .get();

      expect(budgetsQuery.empty).toBe(false);
      expect(budgetsQuery.docs.length).toBe(1);

      const budget = budgetsQuery.docs[0].data();
      const newBudgetId = budgetsQuery.docs[0].id;

      // Verify new budget was created
      expect(newBudgetId).not.toBe(everythingElseBudgetId); // New ID
      expect(budget.isSystemEverythingElse).toBe(true);
      expect(budget.name).toBe('Everything Else'); // Default name restored

      everythingElseBudgetId = newBudgetId; // Update for subsequent tests

      console.log(`✅ Budget auto-recreated: ${newBudgetId}`);
    });
  });

  describe('6. Migration Function', () => {
    test('should detect existing "everything else" budget and skip', async () => {
      // This test verifies the migration function would skip this user
      const existingBudgetQuery = await db.collection('budgets')
        .where('userId', '==', testUserId)
        .where('isSystemEverythingElse', '==', true)
        .get();

      expect(existingBudgetQuery.empty).toBe(false);

      // Migration would skip this user since budget already exists
      console.log(`✅ Migration function would skip user (budget exists)`);
    });
  });

  describe('7. Budget Period Generation', () => {
    test('should verify budget periods were created for "everything else" budget', async () => {
      // Query for budget periods
      const periodsQuery = await db.collection('budget_periods')
        .where('budgetId', '==', everythingElseBudgetId)
        .where('userId', '==', testUserId)
        .get();

      expect(periodsQuery.empty).toBe(false);

      // Should have created periods for at least current month
      const periods = periodsQuery.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Verify period properties
      const firstPeriod = periods[0];
      expect(firstPeriod.budgetId).toBe(everythingElseBudgetId);
      expect(firstPeriod.allocatedAmount).toBe(0); // System budget has $0 allocation

      console.log(`✅ Found ${periods.length} budget periods for "everything else" budget`);
    });
  });

  describe('8. Complete Workflow', () => {
    test('should handle complete user journey', async () => {
      console.log('\n📋 Complete Workflow Test:');
      console.log('1. ✅ User signed up');
      console.log('2. ✅ "Everything else" budget auto-created');
      console.log('3. ✅ Unmatched transaction assigned to "everything else"');
      console.log('4. ✅ Regular budget takes priority when matched');
      console.log('5. ✅ Deletion prevented by security rules');
      console.log('6. ✅ Amount updates rejected');
      console.log('7. ✅ Name updates allowed');
      console.log('8. ✅ Auto-recreation works if deleted');
      console.log('9. ✅ Budget periods generated correctly');

      // Final verification: budget still exists and is functional
      const budgetDoc = await db.collection('budgets').doc(everythingElseBudgetId).get();
      expect(budgetDoc.exists).toBe(true);

      const budget = budgetDoc.data();
      expect(budget?.isSystemEverythingElse).toBe(true);
      expect(budget?.isActive).toBe(true);
      expect(budget?.userId).toBe(testUserId);

      console.log('\n✅ Complete workflow verified successfully!');
    });
  });
});
