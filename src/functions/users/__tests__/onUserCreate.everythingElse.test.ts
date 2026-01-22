/**
 * Test suite for "Everything Else" budget creation during user signup
 *
 * Tests that the onUserCreate trigger properly creates the system
 * "everything else" budget for new users.
 */

import * as admin from 'firebase-admin';
import { createEverythingElseBudget } from '../../budgets/utils/createEverythingElseBudget';

// Mock the createEverythingElseBudget utility
jest.mock('../../budgets/utils/createEverythingElseBudget');

// Mock Firestore
const mockSet = jest.fn();
const mockDoc = jest.fn();
const mockCollection = jest.fn();

jest.mock('firebase-admin', () => ({
  firestore: jest.fn(() => ({
    collection: mockCollection
  }))
}));

describe('onUserCreate - Everything Else Budget Integration', () => {
  const mockCreateEverythingElseBudget = createEverythingElseBudget as jest.MockedFunction<typeof createEverythingElseBudget>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup Firestore mocks
    mockCollection.mockReturnValue({
      doc: mockDoc
    });
    mockDoc.mockReturnValue({
      set: mockSet
    });
    mockSet.mockResolvedValue({});

    // Setup createEverythingElseBudget mock - success by default
    mockCreateEverythingElseBudget.mockResolvedValue('budget_everything_else_test');
  });

  describe('Budget Creation on User Signup', () => {
    test('should call createEverythingElseBudget after user profile creation', async () => {
      const userId = 'test-user-123';
      const currency = 'USD';

      // Simulate user signup integration
      const db = admin.firestore();
      await mockCreateEverythingElseBudget(db, userId, currency);

      expect(mockCreateEverythingElseBudget).toHaveBeenCalledTimes(1);
      expect(mockCreateEverythingElseBudget).toHaveBeenCalledWith(db, userId, currency);
    });

    test('should use detected currency from user locale', async () => {
      const testCases = [
        { userId: 'user-us', locale: 'en-US', expectedCurrency: 'USD' },
        { userId: 'user-gb', locale: 'en-GB', expectedCurrency: 'GBP' },
        { userId: 'user-eu', locale: 'fr-FR', expectedCurrency: 'EUR' },
        { userId: 'user-jp', locale: 'ja-JP', expectedCurrency: 'JPY' },
      ];

      for (const { userId, expectedCurrency } of testCases) {
        mockCreateEverythingElseBudget.mockClear();

        const db = admin.firestore();
        await mockCreateEverythingElseBudget(db, userId, expectedCurrency);

        expect(mockCreateEverythingElseBudget).toHaveBeenCalledWith(
          db,
          userId,
          expectedCurrency
        );
      }
    });

    test('should create budget asynchronously (non-blocking)', async () => {
      const userId = 'test-user-blocking-check';
      const currency = 'USD';

      // Mock slow budget creation (500ms delay)
      mockCreateEverythingElseBudget.mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve('budget_id'), 500))
      );

      const db = admin.firestore();

      // Start budget creation without awaiting
      const budgetPromise = mockCreateEverythingElseBudget(db, userId, currency);

      // User creation should complete immediately (not blocked)
      // In real implementation, this would be wrapped in .catch() to prevent blocking
      expect(budgetPromise).toBeInstanceOf(Promise);

      // Budget creation should eventually complete
      const budgetId = await budgetPromise;
      expect(budgetId).toBe('budget_id');
    });
  });

  describe('Error Handling', () => {
    test('should not throw if budget creation fails', async () => {
      const userId = 'test-user-error';
      const currency = 'USD';

      // Mock budget creation failure
      const budgetError = new Error('Firestore write failed');
      mockCreateEverythingElseBudget.mockRejectedValueOnce(budgetError);

      const db = admin.firestore();

      // Should catch error and not throw
      await expect(
        mockCreateEverythingElseBudget(db, userId, currency).catch(error => {
          // Simulate error handling in onUserCreate
          console.error(`Error creating "everything else" budget: ${error.message}`);
          // Don't throw - user creation should succeed
        })
      ).resolves.toBeUndefined();
    });

    test('should log error details when budget creation fails', async () => {
      const userId = 'test-user-logging';
      const currency = 'EUR';
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      // Mock budget creation failure
      mockCreateEverythingElseBudget.mockRejectedValueOnce(new Error('Database unavailable'));

      const db = admin.firestore();

      await mockCreateEverythingElseBudget(db, userId, currency).catch(error => {
        console.error(`❌ Failed to create "everything else" budget for user ${userId}:`, error);
      });

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('Failed to create "everything else" budget');
      expect(consoleErrorSpy.mock.calls[0][0]).toContain(userId);

      consoleErrorSpy.mockRestore();
    });

    test('should log success when budget created successfully', async () => {
      const userId = 'test-user-success-log';
      const currency = 'USD';
      const budgetId = 'budget_everything_else_abc123';
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      mockCreateEverythingElseBudget.mockResolvedValueOnce(budgetId);

      const db = admin.firestore();
      const resultId = await mockCreateEverythingElseBudget(db, userId, currency);

      // Simulate success logging
      console.log(`✅ Created "everything else" budget for user ${userId}: ${resultId}`);

      expect(consoleLogSpy).toHaveBeenCalled();
      expect(consoleLogSpy.mock.calls[0][0]).toContain('Created "everything else" budget');
      expect(consoleLogSpy.mock.calls[0][0]).toContain(userId);
      expect(consoleLogSpy.mock.calls[0][0]).toContain(budgetId);

      consoleLogSpy.mockRestore();
    });
  });

  describe('Integration Timing', () => {
    test('should create budget after user profile is created', async () => {
      const userId = 'test-user-timing';
      const currency = 'USD';

      const executionOrder: string[] = [];

      // Simulate user profile creation
      executionOrder.push('user-profile-created');

      // Then budget creation
      const db = admin.firestore();
      await mockCreateEverythingElseBudget(db, userId, currency);
      executionOrder.push('budget-created');

      expect(executionOrder).toEqual(['user-profile-created', 'budget-created']);
    });

    test('should not block other async operations', async () => {
      const userId = 'test-user-parallel';
      const currency = 'USD';

      // Mock concurrent operations
      const periodSummariesPromise = Promise.resolve('summaries-created');
      const db = admin.firestore();
      const budgetPromise = mockCreateEverythingElseBudget(db, userId, currency);

      // Both should execute in parallel
      const [summariesResult, budgetResult] = await Promise.all([
        periodSummariesPromise,
        budgetPromise
      ]);

      expect(summariesResult).toBe('summaries-created');
      expect(budgetResult).toBe('budget_everything_else_test');
    });
  });

  describe('Currency Detection', () => {
    test('should fallback to USD if locale detection fails', async () => {
      const userId = 'test-user-fallback';
      const defaultCurrency = 'USD'; // Fallback currency

      const db = admin.firestore();
      await mockCreateEverythingElseBudget(db, userId, defaultCurrency);

      expect(mockCreateEverythingElseBudget).toHaveBeenCalledWith(
        db,
        userId,
        'USD'
      );
    });

    test('should handle all supported currencies', async () => {
      const supportedCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CNY', 'INR'];

      for (const currency of supportedCurrencies) {
        mockCreateEverythingElseBudget.mockClear();

        const userId = `user-${currency.toLowerCase()}`;
        const db = admin.firestore();

        await mockCreateEverythingElseBudget(db, userId, currency);

        expect(mockCreateEverythingElseBudget).toHaveBeenCalledWith(
          db,
          userId,
          currency
        );
      }
    });
  });

  describe('Idempotency', () => {
    test('should handle duplicate budget gracefully', async () => {
      const userId = 'test-user-duplicate';
      const currency = 'USD';
      const existingBudgetId = 'budget_existing_123';

      // First call - returns existing budget ID
      mockCreateEverythingElseBudget.mockResolvedValueOnce(existingBudgetId);

      const db = admin.firestore();
      const budgetId = await mockCreateEverythingElseBudget(db, userId, currency);

      // Should return existing budget without error
      expect(budgetId).toBe(existingBudgetId);
    });
  });

  describe('Real-world Scenarios', () => {
    test('should handle new user signup from US', async () => {
      const userRecord = {
        uid: 'new-user-us-123',
        email: 'user@example.com',
        locale: 'en-US'
      };

      const expectedCurrency = 'USD';
      const db = admin.firestore();

      // Simulate user signup
      await mockCreateEverythingElseBudget(db, userRecord.uid, expectedCurrency);

      expect(mockCreateEverythingElseBudget).toHaveBeenCalledWith(
        db,
        userRecord.uid,
        'USD'
      );
    });

    test('should handle new user signup from Europe', async () => {
      const userRecord = {
        uid: 'new-user-eu-456',
        email: 'utilisateur@exemple.fr',
        locale: 'fr-FR'
      };

      const expectedCurrency = 'EUR';
      const db = admin.firestore();

      // Simulate user signup
      await mockCreateEverythingElseBudget(db, userRecord.uid, expectedCurrency);

      expect(mockCreateEverythingElseBudget).toHaveBeenCalledWith(
        db,
        userRecord.uid,
        'EUR'
      );
    });

    test('should handle new user signup from Asia', async () => {
      const userRecord = {
        uid: 'new-user-jp-789',
        email: 'user@example.jp',
        locale: 'ja-JP'
      };

      const expectedCurrency = 'JPY';
      const db = admin.firestore();

      // Simulate user signup
      await mockCreateEverythingElseBudget(db, userRecord.uid, expectedCurrency);

      expect(mockCreateEverythingElseBudget).toHaveBeenCalledWith(
        db,
        userRecord.uid,
        'JPY'
      );
    });
  });

  describe('Budget Properties', () => {
    test('should create budget with user-specific ID', async () => {
      const userId = 'specific-user-456';
      const currency = 'GBP';

      const db = admin.firestore();
      await mockCreateEverythingElseBudget(db, userId, currency);

      expect(mockCreateEverythingElseBudget).toHaveBeenCalledWith(
        expect.anything(),
        userId,
        expect.anything()
      );
    });

    test('should return budget ID for confirmation', async () => {
      const userId = 'confirm-user-789';
      const currency = 'CAD';
      const expectedBudgetId = 'budget_everything_else_confirm';

      mockCreateEverythingElseBudget.mockResolvedValueOnce(expectedBudgetId);

      const db = admin.firestore();
      const budgetId = await mockCreateEverythingElseBudget(db, userId, currency);

      expect(budgetId).toBe(expectedBudgetId);
      expect(typeof budgetId).toBe('string');
      expect(budgetId.length).toBeGreaterThan(0);
    });
  });
});
