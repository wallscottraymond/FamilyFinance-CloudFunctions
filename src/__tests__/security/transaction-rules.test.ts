/**
 * Security Tests for Transaction Firestore Rules
 *
 * Tests the critical security fix that prevents unauthorized users
 * from listing ALL transactions in the system.
 */

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import { doc, collection, query, where, getDocs, getDoc } from 'firebase/firestore';

describe('Transaction Security Rules', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'test-project',
      firestore: {
        rules: `
          rules_version = '2';
          service cloud.firestore {
            match /databases/{database}/documents {
              // Include the actual rules here
              match /transactions/{transactionId} {
                function isAuthenticated() {
                  return request.auth != null;
                }

                function isOwner(userId) {
                  return request.auth != null && request.auth.uid == userId;
                }

                function inSameFamily(familyId) {
                  return request.auth != null &&
                         get(/databases/$(database)/documents/users/$(request.auth.uid)).data.familyId == familyId;
                }

                allow read: if isOwner(resource.data.userId) ||
                              (resource.data.familyId != null && inSameFamily(resource.data.familyId));

                // SECURE: Only allow users to list their own transactions or family transactions
                allow list: if isAuthenticated() &&
                              (isOwner(resource.data.userId) ||
                               (resource.data.familyId != null && inSameFamily(resource.data.familyId)));

                allow create: if isAuthenticated() &&
                                isOwner(request.resource.data.userId);
              }

              match /users/{userId} {
                allow read, write: if isAuthenticated() && request.auth.uid == userId;
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

  afterEach(async () => {
    await testEnv.clearFirestore();
  });

  describe('Transaction List Security', () => {
    beforeEach(async () => {
      // Setup test data
      const adminContext = testEnv.authenticatedContext('admin', { admin: true });
      const adminFirestore = adminContext.firestore();

      // Create users
      await adminFirestore.doc('users/user1').set({
        email: 'user1@test.com',
        familyId: 'family1'
      });

      await adminFirestore.doc('users/user2').set({
        email: 'user2@test.com',
        familyId: 'family2'
      });

      await adminFirestore.doc('users/user3').set({
        email: 'user3@test.com',
        familyId: 'family1' // Same family as user1
      });

      // Create transactions
      await adminFirestore.doc('transactions/tx1').set({
        userId: 'user1',
        familyId: 'family1',
        amount: 100,
        description: 'User1 transaction'
      });

      await adminFirestore.doc('transactions/tx2').set({
        userId: 'user2',
        familyId: 'family2',
        amount: 200,
        description: 'User2 transaction'
      });

      await adminFirestore.doc('transactions/tx3').set({
        userId: 'user1',
        familyId: 'family1',
        amount: 300,
        description: 'Another User1 transaction'
      });
    });

    test('should prevent unauthorized user from listing ALL transactions', async () => {
      const user1Context = testEnv.authenticatedContext('user1');
      const firestore = user1Context.firestore();

      // This should FAIL - user cannot query all transactions without filters
      await assertFails(
        getDocs(collection(firestore, 'transactions'))
      );
    });

    test('should allow user to list their own transactions', async () => {
      const user1Context = testEnv.authenticatedContext('user1');
      const firestore = user1Context.firestore();

      // This should SUCCEED - user can query their own transactions
      await assertSucceeds(
        getDocs(
          query(
            collection(firestore, 'transactions'),
            where('userId', '==', 'user1')
          )
        )
      );
    });

    test('should allow family member to list family transactions', async () => {
      const user3Context = testEnv.authenticatedContext('user3');
      const firestore = user3Context.firestore();

      // user3 is in family1, should be able to see family1 transactions
      await assertSucceeds(
        getDocs(
          query(
            collection(firestore, 'transactions'),
            where('familyId', '==', 'family1')
          )
        )
      );
    });

    test('should prevent user from listing other family transactions', async () => {
      const user1Context = testEnv.authenticatedContext('user1');
      const firestore = user1Context.firestore();

      // user1 is in family1, should NOT be able to see family2 transactions
      await assertFails(
        getDocs(
          query(
            collection(firestore, 'transactions'),
            where('familyId', '==', 'family2')
          )
        )
      );
    });

    test('should prevent user from querying other users transactions directly', async () => {
      const user1Context = testEnv.authenticatedContext('user1');
      const firestore = user1Context.firestore();

      // user1 should NOT be able to query user2's transactions
      await assertFails(
        getDocs(
          query(
            collection(firestore, 'transactions'),
            where('userId', '==', 'user2')
          )
        )
      );
    });

    test('should prevent unauthenticated access', async () => {
      const unauthenticatedContext = testEnv.unauthenticatedContext();
      const firestore = unauthenticatedContext.firestore();

      // Unauthenticated users should be denied
      await assertFails(
        getDocs(collection(firestore, 'transactions'))
      );
    });
  });

  describe('Individual Transaction Access', () => {
    beforeEach(async () => {
      const adminContext = testEnv.authenticatedContext('admin', { admin: true });
      const adminFirestore = adminContext.firestore();

      // Setup users and transactions
      await adminFirestore.doc('users/user1').set({
        email: 'user1@test.com',
        familyId: 'family1'
      });

      await adminFirestore.doc('users/user2').set({
        email: 'user2@test.com',
        familyId: 'family2'
      });

      await adminFirestore.doc('transactions/user1-tx').set({
        userId: 'user1',
        familyId: 'family1',
        amount: 100,
        description: 'User1 private transaction'
      });

      await adminFirestore.doc('transactions/user2-tx').set({
        userId: 'user2',
        familyId: 'family2',
        amount: 200,
        description: 'User2 private transaction'
      });
    });

    test('should allow user to read their own transaction', async () => {
      const user1Context = testEnv.authenticatedContext('user1');
      const firestore = user1Context.firestore();

      await assertSucceeds(
        getDoc(doc(firestore, 'transactions/user1-tx'))
      );
    });

    test('should prevent user from reading other users transaction', async () => {
      const user1Context = testEnv.authenticatedContext('user1');
      const firestore = user1Context.firestore();

      await assertFails(
        getDoc(doc(firestore, 'transactions/user2-tx'))
      );
    });
  });

  describe('Performance and Edge Cases', () => {
    test('should handle large result sets securely', async () => {
      const adminContext = testEnv.authenticatedContext('admin', { admin: true });
      const adminFirestore = adminContext.firestore();

      // Create many transactions for user1
      const batch = adminFirestore.batch();
      for (let i = 0; i < 100; i++) {
        const docRef = adminFirestore.doc(`transactions/tx-${i}`);
        batch.set(docRef, {
          userId: 'user1',
          familyId: 'family1',
          amount: i * 10,
          description: `Transaction ${i}`
        });
      }
      await batch.commit();

      const user1Context = testEnv.authenticatedContext('user1');
      const firestore = user1Context.firestore();

      // Should be able to query own transactions even with large result set
      await assertSucceeds(
        getDocs(
          query(
            collection(firestore, 'transactions'),
            where('userId', '==', 'user1')
          )
        )
      );
    });

    test('should handle null familyId correctly', async () => {
      const adminContext = testEnv.authenticatedContext('admin', { admin: true });
      const adminFirestore = adminContext.firestore();

      await adminFirestore.doc('users/user1').set({
        email: 'user1@test.com',
        familyId: 'family1'
      });

      // Transaction without familyId
      await adminFirestore.doc('transactions/no-family-tx').set({
        userId: 'user1',
        familyId: null,
        amount: 100,
        description: 'Personal transaction'
      });

      const user1Context = testEnv.authenticatedContext('user1');
      const firestore = user1Context.firestore();

      // Should still be able to access own transaction even without familyId
      await assertSucceeds(
        getDoc(doc(firestore, 'transactions/no-family-tx'))
      );
    });
  });
});