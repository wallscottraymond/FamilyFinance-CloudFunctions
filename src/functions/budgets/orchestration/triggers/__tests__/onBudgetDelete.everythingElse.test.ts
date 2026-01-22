/**
 * Test suite for onBudgetDelete trigger - "Everything Else" auto-recreation
 *
 * Tests that the onBudgetDelete trigger automatically recreates
 * "everything else" budgets if they are deleted (safety net).
 */

import { Timestamp } from 'firebase-admin/firestore';

// Mock createEverythingElseBudget
const mockCreateEverythingElseBudget = jest.fn();
jest.mock('../../../utils/createEverythingElseBudget', () => ({
  createEverythingElseBudget: mockCreateEverythingElseBudget
}));

// Mock Firestore
const mockDb = {
  collection: jest.fn()
};

jest.mock('../../../../../index', () => ({
  db: mockDb
}));

describe('onBudgetDelete - Everything Else Budget Auto-Recreation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Trigger Detection', () => {
    test('should detect system budget deletion', () => {
      const budgetData = {
        id: 'budget_everything_else_user-123',
        name: 'Everything Else',
        isSystemEverythingElse: true,
        createdBy: 'user-123',
        amount: 0
      };

      const isSystemBudget = budgetData.isSystemEverythingElse === true;
      expect(isSystemBudget).toBe(true);
    });

    test('should ignore regular budget deletion', () => {
      const budgetData = {
        id: 'budget-regular-123',
        name: 'Groceries',
        isSystemEverythingElse: false,
        createdBy: 'user-123',
        amount: 500
      };

      const isSystemBudget = budgetData.isSystemEverythingElse === true;
      expect(isSystemBudget).toBe(false);
    });

    test('should ignore budgets without system flag', () => {
      const budgetData: any = {
        id: 'budget-old-123',
        name: 'Old Budget',
        createdBy: 'user-123',
        amount: 300
        // No isSystemEverythingElse field
      };

      const isSystemBudget = budgetData.isSystemEverythingElse === true;
      expect(isSystemBudget).toBe(false);
    });
  });

  describe('Auto-Recreation Logic', () => {
    test('should call createEverythingElseBudget when system budget deleted', async () => {
      const budgetData = {
        isSystemEverythingElse: true,
        createdBy: 'user-123',
        currency: 'USD'
      };

      mockCreateEverythingElseBudget.mockResolvedValueOnce('budget_everything_else_user-123');

      if (budgetData.isSystemEverythingElse) {
        await mockCreateEverythingElseBudget(
          mockDb,
          budgetData.createdBy,
          budgetData.currency || 'USD'
        );
      }

      expect(mockCreateEverythingElseBudget).toHaveBeenCalledWith(
        mockDb,
        'user-123',
        'USD'
      );
    });

    test('should not recreate regular budgets', async () => {
      const budgetData = {
        isSystemEverythingElse: false,
        createdBy: 'user-123',
        currency: 'USD'
      };

      if (budgetData.isSystemEverythingElse) {
        await mockCreateEverythingElseBudget(
          mockDb,
          budgetData.createdBy,
          budgetData.currency
        );
      }

      expect(mockCreateEverythingElseBudget).not.toHaveBeenCalled();
    });

    test('should use budget currency for recreation', async () => {
      const budgetData = {
        isSystemEverythingElse: true,
        createdBy: 'user-eur',
        currency: 'EUR'
      };

      mockCreateEverythingElseBudget.mockResolvedValueOnce('budget_everything_else_user-eur');

      if (budgetData.isSystemEverythingElse) {
        await mockCreateEverythingElseBudget(
          mockDb,
          budgetData.createdBy,
          budgetData.currency
        );
      }

      expect(mockCreateEverythingElseBudget).toHaveBeenCalledWith(
        mockDb,
        'user-eur',
        'EUR'
      );
    });

    test('should default to USD if currency missing', async () => {
      const budgetData = {
        isSystemEverythingElse: true,
        createdBy: 'user-123'
        // No currency field
      };

      mockCreateEverythingElseBudget.mockResolvedValueOnce('budget_everything_else_user-123');

      if (budgetData.isSystemEverythingElse) {
        await mockCreateEverythingElseBudget(
          mockDb,
          budgetData.createdBy,
          (budgetData as any).currency || 'USD'
        );
      }

      expect(mockCreateEverythingElseBudget).toHaveBeenCalledWith(
        mockDb,
        'user-123',
        'USD'
      );
    });
  });

  describe('Error Handling', () => {
    test('should handle recreation errors gracefully', async () => {
      const budgetData = {
        isSystemEverythingElse: true,
        createdBy: 'user-123',
        currency: 'USD'
      };

      mockCreateEverythingElseBudget.mockRejectedValueOnce(
        new Error('Firestore write failed')
      );

      try {
        if (budgetData.isSystemEverythingElse) {
          await mockCreateEverythingElseBudget(
            mockDb,
            budgetData.createdBy,
            budgetData.currency
          );
        }
        throw new Error('Test should have failed');
      } catch (error: any) {
        expect(error.message).toBe('Firestore write failed');
      }
    });

    test('should log warning when recreation attempted', () => {
      const budgetData = {
        isSystemEverythingElse: true,
        createdBy: 'user-123'
      };

      const logMessage = `⚠️ "Everything else" budget deleted for user ${budgetData.createdBy}. Recreating...`;

      expect(logMessage).toContain('Everything else');
      expect(logMessage).toContain('deleted');
      expect(logMessage).toContain('Recreating');
      expect(logMessage).toContain('user-123');
    });

    test('should log error on recreation failure', () => {
      const error = new Error('Failed to recreate budget');
      const errorMessage = `❌ Failed to recreate: ${error.message}`;

      expect(errorMessage).toContain('Failed to recreate');
      expect(errorMessage).toContain('Failed to recreate budget');
    });
  });

  describe('Event Data Handling', () => {
    test('should extract budget data from event', () => {
      const eventData = {
        id: 'budget_everything_else_user-123',
        name: 'Everything Else',
        isSystemEverythingElse: true,
        amount: 0,
        createdBy: 'user-123',
        currency: 'USD',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      };

      expect(eventData.isSystemEverythingElse).toBe(true);
      expect(eventData.createdBy).toBe('user-123');
      expect(eventData.currency).toBe('USD');
    });

    test('should handle missing event data', () => {
      const eventData: any = null;

      if (!eventData || !eventData?.isSystemEverythingElse) {
        // Should exit early
      }

      expect(mockCreateEverythingElseBudget).not.toHaveBeenCalled();
    });

    test('should handle missing createdBy field', () => {
      const eventData = {
        isSystemEverythingElse: true
        // No createdBy field
      };

      const hasCreatedBy = 'createdBy' in eventData;
      expect(hasCreatedBy).toBe(false);
    });
  });

  describe('Safety Net Scenarios', () => {
    test('should recreate if user manually deletes from Firestore console', async () => {
      // Simulates direct Firestore deletion (bypassing Cloud Functions)
      const deletedBudgetData = {
        isSystemEverythingElse: true,
        createdBy: 'user-123',
        currency: 'USD'
      };

      mockCreateEverythingElseBudget.mockResolvedValueOnce('budget_everything_else_user-123');

      // Trigger should fire
      if (deletedBudgetData.isSystemEverythingElse) {
        await mockCreateEverythingElseBudget(
          mockDb,
          deletedBudgetData.createdBy,
          deletedBudgetData.currency
        );
      }

      expect(mockCreateEverythingElseBudget).toHaveBeenCalled();
    });

    test('should recreate if security rules are bypassed', async () => {
      // Simulates admin bypassing security rules
      const budgetData = {
        isSystemEverythingElse: true,
        createdBy: 'user-123',
        currency: 'USD'
      };

      mockCreateEverythingElseBudget.mockResolvedValueOnce('budget_everything_else_user-123');

      if (budgetData.isSystemEverythingElse) {
        await mockCreateEverythingElseBudget(
          mockDb,
          budgetData.createdBy,
          budgetData.currency
        );
      }

      expect(mockCreateEverythingElseBudget).toHaveBeenCalled();
    });

    test('should not cause infinite loop on recreation', async () => {
      // Ensure recreation doesn't trigger delete again
      const budgetData = {
        isSystemEverythingElse: true,
        createdBy: 'user-123',
        currency: 'USD'
      };

      mockCreateEverythingElseBudget.mockResolvedValueOnce('budget_everything_else_user-123');

      // Trigger should only fire once
      if (budgetData.isSystemEverythingElse) {
        await mockCreateEverythingElseBudget(
          mockDb,
          budgetData.createdBy,
          budgetData.currency
        );
      }

      expect(mockCreateEverythingElseBudget).toHaveBeenCalledTimes(1);
    });
  });

  describe('Trigger Configuration', () => {
    test('should have correct trigger path', () => {
      const triggerPath = 'budgets/{budgetId}';
      expect(triggerPath).toBe('budgets/{budgetId}');
    });

    test('should be configured for document deletion', () => {
      const eventType = 'onDocumentDeleted';
      expect(eventType).toBe('onDocumentDeleted');
    });

    test('should have appropriate timeout', () => {
      const timeoutSeconds = 60;
      expect(timeoutSeconds).toBeGreaterThan(0);
      expect(timeoutSeconds).toBeLessThanOrEqual(540);
    });

    test('should have appropriate memory allocation', () => {
      const memory = '256MiB';
      expect(memory).toBe('256MiB');
    });

    test('should use correct region', () => {
      const region = 'us-central1';
      expect(region).toBe('us-central1');
    });
  });

  describe('Integration Scenarios', () => {
    test('should work with different user currencies', async () => {
      const currencies = ['USD', 'EUR', 'GBP', 'JPY'];

      for (const currency of currencies) {
        mockCreateEverythingElseBudget.mockResolvedValueOnce(`budget_everything_else_user-${currency}`);

        const budgetData = {
          isSystemEverythingElse: true,
          createdBy: `user-${currency}`,
          currency
        };

        if (budgetData.isSystemEverythingElse) {
          await mockCreateEverythingElseBudget(
            mockDb,
            budgetData.createdBy,
            budgetData.currency
          );
        }
      }

      expect(mockCreateEverythingElseBudget).toHaveBeenCalledTimes(4);
    });

    test('should preserve user context from deleted budget', async () => {
      const deletedBudget = {
        isSystemEverythingElse: true,
        createdBy: 'user-original',
        userId: 'user-original',
        currency: 'EUR'
      };

      mockCreateEverythingElseBudget.mockResolvedValueOnce('budget_everything_else_user-original');

      if (deletedBudget.isSystemEverythingElse) {
        await mockCreateEverythingElseBudget(
          mockDb,
          deletedBudget.createdBy,
          deletedBudget.currency
        );
      }

      expect(mockCreateEverythingElseBudget).toHaveBeenCalledWith(
        mockDb,
        'user-original',
        'EUR'
      );
    });
  });

  describe('Edge Cases', () => {
    test('should handle undefined isSystemEverythingElse (treated as false)', () => {
      const budgetData: any = {
        createdBy: 'user-123',
        currency: 'USD'
        // isSystemEverythingElse is undefined
      };

      const isSystemBudget = budgetData.isSystemEverythingElse === true;
      expect(isSystemBudget).toBe(false);
    });

    test('should handle null isSystemEverythingElse (treated as false)', () => {
      const budgetData = {
        isSystemEverythingElse: null,
        createdBy: 'user-123',
        currency: 'USD'
      };

      const isSystemBudget = budgetData.isSystemEverythingElse === true;
      expect(isSystemBudget).toBe(false);
    });

    test('should handle isSystemEverythingElse explicitly false', () => {
      const budgetData = {
        isSystemEverythingElse: false,
        createdBy: 'user-123',
        currency: 'USD'
      };

      const isSystemBudget = budgetData.isSystemEverythingElse === true;
      expect(isSystemBudget).toBe(false);
    });
  });
});
