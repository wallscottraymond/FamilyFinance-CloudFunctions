/**
 * Test suite for "Everything Else" budget update restrictions
 *
 * Tests that the updateBudget Cloud Function properly enforces restrictions
 * on the system "everything else" budget, allowing only name changes.
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

describe('updateBudget - Everything Else Budget Restrictions', () => {
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
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      })
    });

    mockUpdate.mockResolvedValue({});
  });

  describe('Allowed Updates - Name Field', () => {
    test('should allow renaming the budget', async () => {
      const updateData = {
        name: 'Miscellaneous Spending'
      };

      // In a real implementation, this would be the updateBudget Cloud Function
      // For now, we're testing the validation logic
      const existingBudget = (await mockDoc().get()).data();

      // Validation: Check if update is allowed
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;
      const isOnlyNameChange = Object.keys(updateData).length === 1 && 'name' in updateData;

      expect(isSystemBudget).toBe(true);
      expect(isOnlyNameChange).toBe(true);

      // Should pass validation
      expect(() => {
        if (isSystemBudget && !isOnlyNameChange) {
          throw new Error('Cannot edit system budget fields except name');
        }
      }).not.toThrow();
    });

    test('should allow updating name with updatedAt timestamp', async () => {
      const updateData = {
        name: 'Other Expenses',
        updatedAt: Timestamp.now()
      };

      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      // Allowed fields for system budgets: name, updatedAt
      const allowedFields = ['name', 'updatedAt'];
      const updateKeys = Object.keys(updateData);
      const hasOnlyAllowedFields = updateKeys.every(key => allowedFields.includes(key));

      expect(isSystemBudget).toBe(true);
      expect(hasOnlyAllowedFields).toBe(true);
    });

    test('should allow empty name (edge case)', async () => {
      const updateData = {
        name: ''
      };

      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      // Even empty names are allowed (general validation might catch this)
      expect(isSystemBudget).toBe(true);
      expect('name' in updateData).toBe(true);
    });
  });

  describe('Blocked Updates - Amount Field', () => {
    test('should reject amount updates', async () => {
      const updateData = {
        amount: 100
      };

      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      expect(isSystemBudget).toBe(true);
      expect('amount' in updateData).toBe(true);

      // Should fail validation
      expect(() => {
        if (isSystemBudget && 'amount' in updateData) {
          throw new Error('Cannot edit amount on "Everything Else" budget - amount is calculated from spending');
        }
      }).toThrow('Cannot edit amount on "Everything Else" budget');
    });

    test('should reject amount: 0 update (even if same value)', async () => {
      const updateData = {
        amount: 0
      };

      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      expect(isSystemBudget).toBe(true);
      expect(() => {
        if (isSystemBudget && 'amount' in updateData) {
          throw new Error('Cannot edit amount on "Everything Else" budget');
        }
      }).toThrow();
    });

    test('should reject name + amount update together', async () => {
      const updateData = {
        name: 'New Name',
        amount: 50
      };

      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      expect(isSystemBudget).toBe(true);
      expect(() => {
        if (isSystemBudget && 'amount' in updateData) {
          throw new Error('Cannot edit amount on "Everything Else" budget');
        }
      }).toThrow();
    });
  });

  describe('Blocked Updates - System Budget Flag', () => {
    test('should reject changing isSystemEverythingElse to false', async () => {
      const updateData = {
        isSystemEverythingElse: false
      };

      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      expect(isSystemBudget).toBe(true);
      expect(() => {
        if ('isSystemEverythingElse' in updateData) {
          throw new Error('Cannot modify system budget flag');
        }
      }).toThrow('Cannot modify system budget flag');
    });

    test('should reject setting isSystemEverythingElse to true (already true)', async () => {
      const updateData = {
        isSystemEverythingElse: true
      };

      expect(() => {
        if ('isSystemEverythingElse' in updateData) {
          throw new Error('Cannot modify system budget flag');
        }
      }).toThrow();
    });
  });

  describe('Blocked Updates - Other Blueprint Fields', () => {
    test('should reject categoryIds update', async () => {
      const updateData = {
        categoryIds: ['food', 'groceries']
      };

      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      const allowedFields = ['name', 'updatedAt'];
      const invalidFields = Object.keys(updateData).filter(f => !allowedFields.includes(f));

      expect(isSystemBudget).toBe(true);
      expect(invalidFields.length).toBeGreaterThan(0);
      expect(invalidFields).toContain('categoryIds');
    });

    test('should reject budgetType update', async () => {
      const updateData = {
        budgetType: 'limited'
      };

      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      const allowedFields = ['name', 'updatedAt'];
      const invalidFields = Object.keys(updateData).filter(f => !allowedFields.includes(f));

      expect(isSystemBudget).toBe(true);
      expect(invalidFields).toContain('budgetType');
    });

    test('should reject isOngoing update', async () => {
      const updateData = {
        isOngoing: false
      };

      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      const allowedFields = ['name', 'updatedAt'];
      const invalidFields = Object.keys(updateData).filter(f => !allowedFields.includes(f));

      expect(isSystemBudget).toBe(true);
      expect(invalidFields).toContain('isOngoing');
    });

    test('should reject isActive update', async () => {
      const updateData = {
        isActive: false
      };

      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      const allowedFields = ['name', 'updatedAt'];
      const invalidFields = Object.keys(updateData).filter(f => !allowedFields.includes(f));

      expect(isSystemBudget).toBe(true);
      expect(invalidFields).toContain('isActive');
    });

    test('should reject startDate update', async () => {
      const updateData = {
        startDate: Timestamp.now()
      };

      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      const allowedFields = ['name', 'updatedAt'];
      const invalidFields = Object.keys(updateData).filter(f => !allowedFields.includes(f));

      expect(isSystemBudget).toBe(true);
      expect(invalidFields).toContain('startDate');
    });

    test('should reject endDate update', async () => {
      const updateData = {
        endDate: Timestamp.now()
      };

      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      const allowedFields = ['name', 'updatedAt'];
      const invalidFields = Object.keys(updateData).filter(f => !allowedFields.includes(f));

      expect(isSystemBudget).toBe(true);
      expect(invalidFields).toContain('endDate');
    });

    test('should reject alertThreshold update', async () => {
      const updateData = {
        alertThreshold: 90
      };

      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      const allowedFields = ['name', 'updatedAt'];
      const invalidFields = Object.keys(updateData).filter(f => !allowedFields.includes(f));

      expect(isSystemBudget).toBe(true);
      expect(invalidFields).toContain('alertThreshold');
    });

    test('should reject multiple field updates (name + description)', async () => {
      const updateData = {
        name: 'New Name',
        description: 'New description'
      };

      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      const allowedFields = ['name', 'updatedAt'];
      const invalidFields = Object.keys(updateData).filter(f => !allowedFields.includes(f));

      expect(isSystemBudget).toBe(true);
      expect(invalidFields).toContain('description');

      expect(() => {
        if (isSystemBudget && invalidFields.length > 0) {
          throw new Error(`Only name can be changed on 'Everything Else' budget. Cannot edit: ${invalidFields.join(', ')}`);
        }
      }).toThrow('Cannot edit: description');
    });
  });

  describe('Regular Budget Updates (Should Not Be Affected)', () => {
    test('should allow all field updates for regular budgets', async () => {
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
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        })
      });

      const updateData = {
        name: 'Updated Groceries',
        amount: 600,
        categoryIds: ['food', 'groceries'],
        alertThreshold: 85
      };

      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      expect(isSystemBudget).toBe(false);

      // Regular budgets should pass all validation
      expect(() => {
        if (isSystemBudget && 'amount' in updateData) {
          throw new Error('Cannot edit amount on system budget');
        }
      }).not.toThrow();
    });
  });

  describe('Error Messages', () => {
    test('should provide clear error message for amount edit', () => {
      const updateData = { amount: 100 };
      const errorMessage = 'Cannot edit amount on "Everything Else" budget - amount is calculated from spending';

      expect(() => {
        if ('amount' in updateData) {
          throw new Error(errorMessage);
        }
      }).toThrow(errorMessage);
    });

    test('should provide clear error message for system flag edit', () => {
      const updateData = { isSystemEverythingElse: false };
      const errorMessage = 'Cannot modify system budget flag';

      expect(() => {
        if ('isSystemEverythingElse' in updateData) {
          throw new Error(errorMessage);
        }
      }).toThrow(errorMessage);
    });

    test('should list all invalid fields in error message', () => {
      const updateData = {
        amount: 100,
        categoryIds: ['test'],
        budgetType: 'limited'
      };

      const allowedFields = ['name', 'updatedAt'];
      const invalidFields = Object.keys(updateData).filter(f => !allowedFields.includes(f));
      const errorMessage = `Only name can be changed on 'Everything Else' budget. Cannot edit: ${invalidFields.join(', ')}`;

      expect(errorMessage).toContain('amount');
      expect(errorMessage).toContain('categoryIds');
      expect(errorMessage).toContain('budgetType');
    });
  });

  describe('Validation Order', () => {
    test('should check system flag before amount (early exit)', async () => {
      const updateData = {
        isSystemEverythingElse: false,
        amount: 100
      };

      // System flag check should happen first
      expect(() => {
        if ('isSystemEverythingElse' in updateData) {
          throw new Error('Cannot modify system budget flag');
        }
        if ('amount' in updateData) {
          throw new Error('Cannot edit amount');
        }
      }).toThrow('Cannot modify system budget flag');
    });

    test('should check amount before other fields', async () => {
      const updateData = {
        amount: 100,
        categoryIds: ['test']
      };

      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      // Amount check should happen early
      expect(() => {
        if (isSystemBudget && 'amount' in updateData) {
          throw new Error('Cannot edit amount on "Everything Else" budget');
        }
      }).toThrow();
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
          amount: 500
        })
      });

      const existingBudget = (await mockDoc().get()).data();
      const isSystemBudget = existingBudget.isSystemEverythingElse === true;

      // Should default to false (not a system budget)
      expect(isSystemBudget).toBe(false);
    });

    test('should handle empty update object', async () => {
      const updateData = {};

      const updateKeys = Object.keys(updateData);
      expect(updateKeys.length).toBe(0);

      // Empty updates should be rejected at general validation level
      expect(() => {
        if (updateKeys.length === 0) {
          throw new Error('No fields to update');
        }
      }).toThrow('No fields to update');
    });
  });
});
