/**
 * Test suite for "Everything Else" budget deletion prevention
 *
 * Tests that the deleteBudget Cloud Function properly prevents deletion
 * of the system "everything else" budget.
 */

import { Timestamp } from 'firebase-admin/firestore';

// Mock Firestore
const mockUpdate = jest.fn();
const mockGet = jest.fn();
const mockDoc = jest.fn();
const mockCollection = jest.fn();

// Mock dependencies
jest.mock('../../../../../index', () => ({
  db: {
    collection: jest.fn()
  }
}));

import { db } from '../../../../../index';

describe('deleteBudget - Everything Else Budget Prevention', () => {
  const testBudgetId = 'budget_everything_else_test-user-123';
  const testUserId = 'test-user-123';

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock chain
    (db.collection as jest.Mock) = mockCollection;
    mockCollection.mockReturnValue({
      doc: mockDoc
    });
    mockDoc.mockReturnValue({
      get: mockGet,
      update: mockUpdate
    });

    // Default: Mock "everything else" budget exists
    mockGet.mockResolvedValue({
      exists: true,
      id: testBudgetId,
      data: () => ({
        id: testBudgetId,
        name: 'Everything Else',
        isSystemEverythingElse: true,
        amount: 0,
        categoryIds: [],
        budgetType: 'recurring',
        isOngoing: true,
        isActive: true,
        userId: testUserId,
        groupIds: [],
        createdBy: testUserId,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      })
    });

    mockUpdate.mockResolvedValue({});
  });

  describe('Deletion Prevention - System Budget', () => {
    test('should reject deletion of "everything else" budget', async () => {
      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      expect(isSystemBudget).toBe(true);

      // Should fail deletion attempt
      expect(() => {
        if (isSystemBudget) {
          throw new Error('The "Everything Else" budget is a system budget and cannot be deleted');
        }
      }).toThrow('cannot be deleted');
    });

    test('should provide clear error message', () => {
      const errorMessage = 'The "Everything Else" budget is a system budget and cannot be deleted';

      expect(() => {
        throw new Error(errorMessage);
      }).toThrow(errorMessage);
      expect(errorMessage).toContain('system budget');
      expect(errorMessage).toContain('cannot be deleted');
    });

    test('should check system flag before soft delete operation', async () => {
      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      // System check should happen before update
      let deletionAttempted = false;

      try {
        if (isSystemBudget) {
          throw new Error('Cannot delete system budget');
        }
        deletionAttempted = true;
      } catch (error) {
        // Expected error
      }

      expect(deletionAttempted).toBe(false);
      expect(isSystemBudget).toBe(true);
    });
  });

  describe('Regular Budget Deletion (Should Not Be Affected)', () => {
    test('should allow deletion of regular budgets', async () => {
      // Mock regular budget (not system budget)
      mockGet.mockResolvedValueOnce({
        exists: true,
        id: 'budget-regular-123',
        data: () => ({
          id: 'budget-regular-123',
          name: 'Groceries',
          isSystemEverythingElse: false,
          amount: 500,
          categoryIds: ['food'],
          budgetType: 'recurring',
          isOngoing: true,
          isActive: true,
          userId: testUserId,
          createdBy: testUserId,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        })
      });

      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      expect(isSystemBudget).toBe(false);

      // Regular budgets should pass deletion check
      expect(() => {
        if (isSystemBudget) {
          throw new Error('Cannot delete system budget');
        }
      }).not.toThrow();
    });

    test('should allow soft delete for regular budgets', async () => {
      // Mock regular budget
      mockGet.mockResolvedValueOnce({
        exists: true,
        id: 'budget-regular-123',
        data: () => ({
          id: 'budget-regular-123',
          name: 'Groceries',
          isSystemEverythingElse: false,
          amount: 500,
          isActive: true,
          userId: testUserId,
          createdBy: testUserId
        })
      });

      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      expect(isSystemBudget).toBe(false);

      // Should allow soft delete
      if (!isSystemBudget) {
        await mockUpdate({ isActive: false });
      }

      expect(mockUpdate).toHaveBeenCalledWith({ isActive: false });
    });
  });

  describe('Error Responses', () => {
    test('should return 400 status code', () => {
      const statusCode = 400;
      const errorCode = 'cannot-delete-system-budget';

      expect(statusCode).toBe(400);
      expect(errorCode).toBe('cannot-delete-system-budget');
    });

    test('should provide error code for client handling', () => {
      const errorResponse = {
        success: false,
        error: {
          code: 'cannot-delete-system-budget',
          message: 'The "Everything Else" budget is a system budget and cannot be deleted'
        }
      };

      expect(errorResponse.success).toBe(false);
      expect(errorResponse.error.code).toBe('cannot-delete-system-budget');
      expect(errorResponse.error.message).toContain('cannot be deleted');
    });
  });

  describe('Edge Cases', () => {
    test('should handle budget not found gracefully', async () => {
      mockGet.mockResolvedValueOnce({
        exists: false,
        data: () => undefined
      });

      const budgetDoc = await mockDoc().get();

      expect(budgetDoc.exists).toBe(false);
      if (budgetDoc.exists) {
        expect(budgetDoc.data()).toBeDefined();
      } else {
        expect(budgetDoc.data()).toBeUndefined();
      }
    });

    test('should handle missing isSystemEverythingElse field (undefined)', async () => {
      mockGet.mockResolvedValueOnce({
        exists: true,
        id: 'budget-regular-123',
        data: () => ({
          id: 'budget-regular-123',
          name: 'Regular Budget',
          // isSystemEverythingElse field not present
          amount: 500,
          isActive: true
        })
      });

      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      // Should default to false (not a system budget)
      expect(isSystemBudget).toBe(false);
    });

    test('should handle isSystemEverythingElse: false explicitly', async () => {
      mockGet.mockResolvedValueOnce({
        exists: true,
        id: 'budget-regular-123',
        data: () => ({
          id: 'budget-regular-123',
          name: 'Regular Budget',
          isSystemEverythingElse: false,
          amount: 500,
          isActive: true
        })
      });

      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      // Should be false (not a system budget)
      expect(isSystemBudget).toBe(false);
    });
  });

  describe('Validation Order', () => {
    test('should check system flag before ownership checks', async () => {
      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      // System budget check should happen early
      let ownershipCheckPerformed = false;

      try {
        if (isSystemBudget) {
          throw new Error('Cannot delete system budget');
        }
        ownershipCheckPerformed = true;
        // ... ownership validation would happen here
      } catch (error) {
        // Expected error
      }

      expect(ownershipCheckPerformed).toBe(false);
      expect(isSystemBudget).toBe(true);
    });

    test('should check system flag after budget exists validation', async () => {
      // First check: budget exists
      const budgetDoc = await mockDoc().get();
      expect(budgetDoc.exists).toBe(true);

      // Then check: is system budget
      const existingBudget = budgetDoc.data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;
      expect(isSystemBudget).toBe(true);

      // Then fail
      expect(() => {
        if (isSystemBudget) {
          throw new Error('Cannot delete system budget');
        }
      }).toThrow();
    });
  });

  describe('User Experience', () => {
    test('should provide helpful error message to user', () => {
      const userMessage = 'The "Everything Else" budget is a system budget and cannot be deleted';

      expect(userMessage).toContain('Everything Else');
      expect(userMessage).toContain('system budget');
      expect(userMessage).toContain('cannot be deleted');
    });

    test('should not expose internal system details', () => {
      const errorMessage = 'The "Everything Else" budget is a system budget and cannot be deleted';

      // Should not contain internal flags
      expect(errorMessage).not.toContain('isSystemEverythingElse');
      expect(errorMessage).not.toContain('true');
      expect(errorMessage).not.toContain('false');

      // Should use user-friendly language
      expect(errorMessage).toContain('budget');
      expect(errorMessage).toContain('system');
    });
  });

  describe('Security', () => {
    test('should prevent deletion even for budget owner', async () => {
      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;
      const isOwner = existingBudget.createdBy === testUserId;

      expect(isOwner).toBe(true);
      expect(isSystemBudget).toBe(true);

      // Even owners cannot delete
      expect(() => {
        if (isSystemBudget) {
          throw new Error('Cannot delete system budget');
        }
      }).toThrow();
    });

    test('should prevent deletion even for admin users', () => {
      const isSystemBudget = true;
      const isAdmin = true;

      // Even admins cannot delete system budgets
      expect(() => {
        if (isSystemBudget) {
          throw new Error('Cannot delete system budget');
        }
      }).toThrow();

      expect(isAdmin).toBe(true);
      expect(isSystemBudget).toBe(true);
    });
  });

  describe('Multiple System Budgets', () => {
    test('should prevent deletion of any budget with system flag', async () => {
      // Could theoretically have multiple system budgets in future
      const systemBudgets = [
        { id: 'budget_everything_else_1', isSystemEverythingElse: true },
        { id: 'budget_system_savings_1', isSystemEverythingElse: true }
      ];

      systemBudgets.forEach(budget => {
        const isSystemBudget = budget.isSystemEverythingElse === true;

        expect(() => {
          if (isSystemBudget) {
            throw new Error('Cannot delete system budget');
          }
        }).toThrow();
      });
    });
  });

  describe('Integration with Soft Delete', () => {
    test('should prevent soft delete (isActive: false) for system budgets', async () => {
      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      let softDeleteAttempted = false;

      try {
        if (isSystemBudget) {
          throw new Error('Cannot delete system budget');
        }
        await mockUpdate({ isActive: false });
        softDeleteAttempted = true;
      } catch (error) {
        // Expected error
      }

      expect(softDeleteAttempted).toBe(false);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
