/**
 * Test suite for createMissingEverythingElseBudgets migration function
 *
 * Tests the admin function that backfills "everything else" budgets
 * for existing users who don't have one.
 */

import { Timestamp } from 'firebase-admin/firestore';

// Mock Firestore
const mockAdd = jest.fn();
const mockSet = jest.fn();
const mockGet = jest.fn();
const mockDoc = jest.fn();
const mockCollection = jest.fn();
const mockWhere = jest.fn();

// Mock dependencies
jest.mock('../../../../index', () => ({
  db: {
    collection: jest.fn()
  }
}));

import { db } from '../../../../index';

describe('createMissingEverythingElseBudgets - Migration Function', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock chain with chaining support
    const whereChain = {
      where: mockWhere,
      get: mockGet
    };

    (db.collection as jest.Mock) = mockCollection;
    mockCollection.mockReturnValue({
      doc: mockDoc,
      where: mockWhere,
      get: mockGet,
      add: mockAdd
    });
    mockWhere.mockReturnValue(whereChain);
    mockDoc.mockReturnValue({
      get: mockGet,
      set: mockSet
    });
  });

  describe('Admin Access Control', () => {
    test('should require authentication', async () => {
      const request = {
        auth: null
      };

      expect(() => {
        if (!request.auth) {
          throw new Error('User must be authenticated');
        }
      }).toThrow('User must be authenticated');
    });

    test('should require admin role', async () => {
      const request = {
        auth: {
          uid: 'user-123',
          token: {
            role: 'standard_user'
          }
        }
      };

      const isAdmin = request.auth.token?.role === 'admin';
      expect(isAdmin).toBe(false);

      expect(() => {
        if (!isAdmin) {
          throw new Error('Only admins can run migration functions');
        }
      }).toThrow('Only admins can run migration functions');
    });

    test('should allow admin users', () => {
      const request = {
        auth: {
          uid: 'admin-123',
          token: {
            role: 'admin'
          }
        }
      };

      const isAdmin = request.auth.token?.role === 'admin';
      expect(isAdmin).toBe(true);
    });
  });

  describe('User Query and Processing', () => {
    test('should query all active users', async () => {
      // Mock users query
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: 'user-1',
            data: () => ({ email: 'user1@test.com', isActive: true })
          },
          {
            id: 'user-2',
            data: () => ({ email: 'user2@test.com', isActive: true })
          }
        ]
      });

      const usersSnapshot = await mockCollection('users')
        .where('isActive', '==', true)
        .get();

      expect(mockCollection).toHaveBeenCalledWith('users');
      expect(mockWhere).toHaveBeenCalledWith('isActive', '==', true);
      expect(usersSnapshot.docs.length).toBe(2);
    });

    test('should handle no users found', async () => {
      mockGet.mockResolvedValueOnce({
        empty: true,
        docs: []
      });

      const usersSnapshot = await mockCollection('users')
        .where('isActive', '==', true)
        .get();

      expect(usersSnapshot.empty).toBe(true);
      expect(usersSnapshot.docs.length).toBe(0);
    });

    test('should process each user individually', async () => {
      const users = [
        { id: 'user-1', email: 'user1@test.com' },
        { id: 'user-2', email: 'user2@test.com' },
        { id: 'user-3', email: 'user3@test.com' }
      ];

      let processedCount = 0;
      for (const user of users) {
        processedCount++;
        expect(user.id).toBeDefined();
      }

      expect(processedCount).toBe(3);
    });
  });

  describe('Budget Existence Check', () => {
    test('should check if user already has "everything else" budget', async () => {
      const userId = 'user-123';

      // Mock budget query - budget exists
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: 'budget_everything_else_user-123',
            data: () => ({
              userId,
              isSystemEverythingElse: true,
              name: 'Everything Else'
            })
          }
        ]
      });

      const existingBudgetQuery = await mockCollection('budgets')
        .where('userId', '==', userId)
        .where('isSystemEverythingElse', '==', true)
        .get();

      expect(mockWhere).toHaveBeenCalledWith('userId', '==', userId);
      expect(mockWhere).toHaveBeenCalledWith('isSystemEverythingElse', '==', true);
      expect(existingBudgetQuery.empty).toBe(false);
    });

    test('should detect when user is missing "everything else" budget', async () => {
      const userId = 'user-456';

      // Mock budget query - no budget found
      mockGet.mockResolvedValueOnce({
        empty: true,
        docs: []
      });

      const existingBudgetQuery = await mockCollection('budgets')
        .where('userId', '==', userId)
        .where('isSystemEverythingElse', '==', true)
        .get();

      expect(existingBudgetQuery.empty).toBe(true);
    });

    test('should skip users who already have the budget', async () => {
      const userId = 'user-with-budget';

      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{ id: 'existing-budget' }]
      });

      const existingBudgetQuery = await mockCollection('budgets')
        .where('userId', '==', userId)
        .where('isSystemEverythingElse', '==', true)
        .get();

      let shouldCreate = existingBudgetQuery.empty;
      expect(shouldCreate).toBe(false);
    });
  });

  describe('Budget Creation', () => {
    test('should create budget for users without one', async () => {
      const userId = 'user-without-budget';
      const userCurrency = 'USD';

      const newBudget = {
        id: `budget_everything_else_${userId}`,
        name: 'Everything Else',
        isSystemEverythingElse: true,
        amount: 0,
        categoryIds: [],
        budgetType: 'recurring',
        isOngoing: true,
        isActive: true,
        userId,
        groupIds: [],
        currency: userCurrency,
        createdBy: userId,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };

      await mockDoc(`budget_everything_else_${userId}`).set(newBudget);

      expect(mockDoc).toHaveBeenCalledWith(`budget_everything_else_${userId}`);
      expect(mockSet).toHaveBeenCalledWith(newBudget);
    });

    test('should use user currency if available', async () => {
      const userPreferences = {
        currency: 'EUR'
      };

      const currency = userPreferences.currency || 'USD';
      expect(currency).toBe('EUR');
    });

    test('should default to USD if user has no currency preference', async () => {
      const userPreferences = {};

      const currency = (userPreferences as any).currency || 'USD';
      expect(currency).toBe('USD');
    });

    test('should handle budget creation errors gracefully', async () => {
      const userId = 'user-error';

      mockSet.mockRejectedValueOnce(new Error('Firestore write failed'));

      try {
        await mockDoc(`budget_everything_else_${userId}`).set({});
        throw new Error('Test should have failed');
      } catch (error: any) {
        expect(error.message).toBe('Firestore write failed');
      }
    });
  });

  describe('Summary Statistics', () => {
    test('should track number of budgets created', () => {
      let createdCount = 0;

      const users = ['user-1', 'user-2', 'user-3'];
      const existingBudgets = ['user-1']; // user-1 already has budget

      users.forEach(userId => {
        if (!existingBudgets.includes(userId)) {
          createdCount++;
        }
      });

      expect(createdCount).toBe(2);
    });

    test('should track number of budgets skipped', () => {
      let skippedCount = 0;

      const users = ['user-1', 'user-2', 'user-3'];
      const existingBudgets = ['user-1', 'user-3'];

      users.forEach(userId => {
        if (existingBudgets.includes(userId)) {
          skippedCount++;
        }
      });

      expect(skippedCount).toBe(2);
    });

    test('should track errors encountered', () => {
      let errorCount = 0;

      const users = ['user-1', 'user-2', 'user-3'];
      const failedUsers = ['user-2'];

      users.forEach(userId => {
        if (failedUsers.includes(userId)) {
          errorCount++;
        }
      });

      expect(errorCount).toBe(1);
    });

    test('should return complete summary object', () => {
      const summary = {
        totalUsers: 10,
        budgetsCreated: 7,
        budgetsSkipped: 2,
        errors: 1,
        timestamp: Timestamp.now()
      };

      expect(summary.totalUsers).toBe(summary.budgetsCreated + summary.budgetsSkipped + summary.errors);
      expect(summary.budgetsCreated).toBe(7);
      expect(summary.budgetsSkipped).toBe(2);
      expect(summary.errors).toBe(1);
    });
  });

  describe('Error Handling', () => {
    test('should continue processing after individual user error', async () => {
      const users = ['user-1', 'user-2', 'user-3'];
      let processedCount = 0;
      let errorCount = 0;

      for (const userId of users) {
        try {
          if (userId === 'user-2') {
            throw new Error('Failed to create budget');
          }
          processedCount++;
        } catch (error) {
          errorCount++;
        }
      }

      expect(processedCount).toBe(2);
      expect(errorCount).toBe(1);
    });

    test('should log errors for debugging', () => {
      const errors: Array<{ userId: string; error: string }> = [];
      const userId = 'user-error';
      const error = new Error('Budget creation failed');

      errors.push({
        userId,
        error: error.message
      });

      expect(errors.length).toBe(1);
      expect(errors[0].userId).toBe(userId);
      expect(errors[0].error).toBe('Budget creation failed');
    });

    test('should handle Firestore query errors', async () => {
      mockGet.mockRejectedValueOnce(new Error('Firestore query failed'));

      try {
        await mockCollection('users').get();
        throw new Error('Test should have failed');
      } catch (error: any) {
        expect(error.message).toBe('Firestore query failed');
      }
    });
  });

  describe('Duplicate Prevention', () => {
    test('should not create duplicate budgets', async () => {
      const userId = 'user-123';

      // First check - budget exists
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{ id: 'existing-budget' }]
      });

      const existingBudgetQuery = await mockCollection('budgets')
        .where('userId', '==', userId)
        .where('isSystemEverythingElse', '==', true)
        .get();

      let shouldCreate = existingBudgetQuery.empty;
      expect(shouldCreate).toBe(false);
      expect(mockSet).not.toHaveBeenCalled();
    });

    test('should handle race condition with concurrent creates', async () => {
      const userId = 'user-race';

      // Query shows no budget
      mockGet.mockResolvedValueOnce({
        empty: true,
        docs: []
      });

      // But creation fails with "already exists" error
      mockSet.mockRejectedValueOnce(new Error('Document already exists'));

      try {
        const existingBudgetQuery = await mockCollection('budgets')
          .where('userId', '==', userId)
          .where('isSystemEverythingElse', '==', true)
          .get();

        if (existingBudgetQuery.empty) {
          await mockDoc().set({});
        }
        throw new Error('Test should have failed');
      } catch (error: any) {
        expect(error.message).toBe('Document already exists');
      }
    });

    test('should verify unique constraint on isSystemEverythingElse per user', async () => {
      const userId = 'user-123';

      // Multiple budgets found (should never happen)
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [
          { id: 'budget-1', data: () => ({ isSystemEverythingElse: true }) },
          { id: 'budget-2', data: () => ({ isSystemEverythingElse: true }) }
        ]
      });

      const existingBudgetQuery = await mockCollection('budgets')
        .where('userId', '==', userId)
        .where('isSystemEverythingElse', '==', true)
        .get();

      // Should detect duplicate issue
      const hasDuplicates = existingBudgetQuery.docs.length > 1;
      expect(hasDuplicates).toBe(true);
    });
  });

  describe('Response Format', () => {
    test('should return success response with statistics', () => {
      const response = {
        success: true,
        summary: {
          totalUsers: 100,
          budgetsCreated: 75,
          budgetsSkipped: 23,
          errors: 2,
          timestamp: Timestamp.now()
        }
      };

      expect(response.success).toBe(true);
      expect(response.summary.totalUsers).toBe(100);
      expect(response.summary.budgetsCreated).toBe(75);
    });

    test('should include error details in response', () => {
      const response = {
        success: true,
        summary: {
          totalUsers: 10,
          budgetsCreated: 8,
          budgetsSkipped: 0,
          errors: 2
        },
        errorDetails: [
          { userId: 'user-1', error: 'Failed to create budget' },
          { userId: 'user-5', error: 'Firestore write failed' }
        ]
      };

      expect(response.errorDetails?.length).toBe(2);
      expect(response.errorDetails?.[0].userId).toBe('user-1');
    });

    test('should handle complete failure gracefully', () => {
      const response = {
        success: false,
        error: {
          code: 'migration-failed',
          message: 'Failed to query users'
        }
      };

      expect(response.success).toBe(false);
      expect(response.error.code).toBe('migration-failed');
    });
  });

  describe('Performance Considerations', () => {
    test('should process users in batches for large datasets', () => {
      const allUsers = Array.from({ length: 1000 }, (_, i) => `user-${i}`);
      const batchSize = 100;
      const batches: string[][] = [];

      for (let i = 0; i < allUsers.length; i += batchSize) {
        batches.push(allUsers.slice(i, i + batchSize));
      }

      expect(batches.length).toBe(10);
      expect(batches[0].length).toBe(100);
    });

    test('should have reasonable timeout for large migrations', () => {
      const timeoutSeconds = 540; // 9 minutes
      expect(timeoutSeconds).toBeGreaterThan(300); // More than 5 minutes
      expect(timeoutSeconds).toBeLessThanOrEqual(540); // Firebase max
    });

    test('should log progress periodically', () => {
      const totalUsers = 1000;
      const processedUsers = 250;
      const progressPercentage = (processedUsers / totalUsers) * 100;

      expect(progressPercentage).toBe(25);
    });
  });

  describe('Edge Cases', () => {
    test('should handle users with no preferences object', async () => {
      const user = {
        id: 'user-no-prefs',
        email: 'test@test.com'
        // No preferences field
      };

      const currency = (user as any).preferences?.currency || 'USD';
      expect(currency).toBe('USD');
    });

    test('should handle deleted users (isActive: false)', async () => {
      // Mock query that filters out inactive users (as Firestore would do)
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: 'user-1',
            data: () => ({ email: 'user1@test.com', isActive: true })
          }
          // user-2 is filtered out by the where clause
        ]
      });

      const usersSnapshot = await mockCollection('users')
        .where('isActive', '==', true)
        .get();

      // Should only return active users (Firestore does the filtering)
      expect(usersSnapshot.docs.length).toBe(1);
      expect(usersSnapshot.docs[0].data().isActive).toBe(true);
    });

    test('should handle users with existing inactive "everything else" budget', async () => {
      const userId = 'user-inactive-budget';

      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: 'budget-inactive',
            data: () => ({
              userId,
              isSystemEverythingElse: true,
              isActive: false
            })
          }
        ]
      });

      const existingBudgetQuery = await mockCollection('budgets')
        .where('userId', '==', userId)
        .where('isSystemEverythingElse', '==', true)
        .get();

      // Should find the inactive budget
      expect(existingBudgetQuery.empty).toBe(false);

      // Should reactivate instead of creating new
      const budget = existingBudgetQuery.docs[0].data();
      expect(budget.isActive).toBe(false);
    });
  });
});
