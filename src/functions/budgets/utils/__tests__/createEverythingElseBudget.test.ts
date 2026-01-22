/**
 * Comprehensive test suite for createEverythingElseBudget utility
 *
 * Tests the creation of the system "everything else" budget that acts as a
 * catch-all for transactions not assigned to any other budget.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { createEverythingElseBudget } from '../createEverythingElseBudget';

// Mock Firestore
const mockAdd = jest.fn();
const mockGet = jest.fn();
const mockWhere = jest.fn();
const mockLimit = jest.fn();
const mockCollection = jest.fn();

const mockFirestore = {
  collection: mockCollection
} as any;

describe('createEverythingElseBudget', () => {
  const testUserId = 'test-user-123';
  const testCurrency = 'USD';
  const mockDocId = 'budget_everything_else_test-user-123';

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mock chain
    mockCollection.mockReturnValue({
      where: mockWhere
    });
    mockWhere.mockReturnValue({
      where: mockWhere,
      limit: mockLimit
    });
    mockLimit.mockReturnValue({
      get: mockGet
    });
    mockGet.mockResolvedValue({
      empty: true,
      docs: []
    });

    // Setup add mock
    mockCollection.mockReturnValue({
      where: mockWhere,
      add: mockAdd
    });
    mockAdd.mockResolvedValue({
      id: mockDocId
    });
  });

  describe('Happy Path - Budget Creation', () => {
    test('should create budget with correct system configuration', async () => {
      const budgetId = await createEverythingElseBudget(mockFirestore, testUserId, testCurrency);

      expect(budgetId).toBe(mockDocId);
      expect(mockAdd).toHaveBeenCalledTimes(1);

      const budgetData = mockAdd.mock.calls[0][0];

      // System budget identification
      expect(budgetData.isSystemEverythingElse).toBe(true);

      // Budget configuration
      expect(budgetData.name).toBe('Everything Else');
      expect(budgetData.amount).toBe(0);
      expect(budgetData.categoryIds).toEqual([]);
      expect(budgetData.budgetType).toBe('recurring');
      expect(budgetData.isOngoing).toBe(true);
      expect(budgetData.isActive).toBe(true);

      // Ownership and sharing
      expect(budgetData.userId).toBe(testUserId);
      expect(budgetData.groupIds).toEqual([]);

      // Access control
      expect(budgetData.access).toBeDefined();
      expect(budgetData.access.ownerId).toBe(testUserId);
      expect(budgetData.access.createdBy).toBe(testUserId);
      expect(budgetData.access.isPrivate).toBe(true);
    });

    test('should set correct timestamps', async () => {
      await createEverythingElseBudget(mockFirestore, testUserId, testCurrency);

      const budgetData = mockAdd.mock.calls[0][0];

      expect(budgetData.createdAt).toBeInstanceOf(Timestamp);
      expect(budgetData.updatedAt).toBeInstanceOf(Timestamp);
      expect(budgetData.startDate).toBeInstanceOf(Timestamp);
    });

    test('should set correct period configuration', async () => {
      await createEverythingElseBudget(mockFirestore, testUserId, testCurrency);

      const budgetData = mockAdd.mock.calls[0][0];

      expect(budgetData.period).toBe('monthly');
      expect(budgetData.spent).toBe(0);
      expect(budgetData.remaining).toBe(0);
      expect(budgetData.alertThreshold).toBe(80);
    });

    test('should handle custom currency', async () => {
      const eurCurrency = 'EUR';
      await createEverythingElseBudget(mockFirestore, testUserId, eurCurrency);

      const budgetData = mockAdd.mock.calls[0][0];
      expect(budgetData.currency).toBe(eurCurrency);
    });

    test('should default to USD currency', async () => {
      await createEverythingElseBudget(mockFirestore, testUserId);

      const budgetData = mockAdd.mock.calls[0][0];
      expect(budgetData.currency).toBe('USD');
    });
  });

  describe('User Association', () => {
    test('should correctly set all user ID fields', async () => {
      await createEverythingElseBudget(mockFirestore, testUserId, testCurrency);

      const budgetData = mockAdd.mock.calls[0][0];

      // Root-level user ID
      expect(budgetData.userId).toBe(testUserId);

      // Access control object
      expect(budgetData.access.ownerId).toBe(testUserId);
      expect(budgetData.access.createdBy).toBe(testUserId);
    });

    test('should mark budget as private (no group sharing)', async () => {
      await createEverythingElseBudget(mockFirestore, testUserId, testCurrency);

      const budgetData = mockAdd.mock.calls[0][0];

      expect(budgetData.groupIds).toEqual([]);
      expect(budgetData.access.isPrivate).toBe(true);
    });
  });

  describe('Idempotency - Duplicate Prevention', () => {
    test('should not create duplicate if budget already exists', async () => {
      // Mock existing budget
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{
          id: 'existing-budget-id',
          data: () => ({
            isSystemEverythingElse: true,
            userId: testUserId
          })
        }]
      });

      const budgetId = await createEverythingElseBudget(mockFirestore, testUserId, testCurrency);

      // Should return existing budget ID
      expect(budgetId).toBe('existing-budget-id');

      // Should NOT call add
      expect(mockAdd).not.toHaveBeenCalled();

      // Should query for existing budget
      expect(mockWhere).toHaveBeenCalledWith('userId', '==', testUserId);
      expect(mockWhere).toHaveBeenCalledWith('isSystemEverythingElse', '==', true);
    });

    test('should query with correct filters for duplicate check', async () => {
      await createEverythingElseBudget(mockFirestore, testUserId, testCurrency);

      expect(mockCollection).toHaveBeenCalledWith('budgets');
      expect(mockWhere).toHaveBeenCalledWith('userId', '==', testUserId);
      expect(mockWhere).toHaveBeenCalledWith('isSystemEverythingElse', '==', true);
      expect(mockLimit).toHaveBeenCalledWith(1);
    });
  });

  describe('Error Handling', () => {
    test('should throw error if userId is missing', async () => {
      await expect(
        createEverythingElseBudget(mockFirestore, '', testCurrency)
      ).rejects.toThrow('userId is required');
    });

    test('should throw error if userId is null', async () => {
      await expect(
        createEverythingElseBudget(mockFirestore, null as any, testCurrency)
      ).rejects.toThrow('userId is required');
    });

    test('should throw error if userId is undefined', async () => {
      await expect(
        createEverythingElseBudget(mockFirestore, undefined as any, testCurrency)
      ).rejects.toThrow('userId is required');
    });

    test('should handle Firestore add errors', async () => {
      const firestoreError = new Error('Firestore write failed');
      mockAdd.mockRejectedValueOnce(firestoreError);

      await expect(
        createEverythingElseBudget(mockFirestore, testUserId, testCurrency)
      ).rejects.toThrow('Firestore write failed');
    });

    test('should handle Firestore query errors during duplicate check', async () => {
      const queryError = new Error('Firestore query failed');
      mockGet.mockRejectedValueOnce(queryError);

      await expect(
        createEverythingElseBudget(mockFirestore, testUserId, testCurrency)
      ).rejects.toThrow('Firestore query failed');
    });

    test('should validate currency format', async () => {
      await expect(
        createEverythingElseBudget(mockFirestore, testUserId, '')
      ).rejects.toThrow('currency must be a valid 3-letter code');
    });

    test('should accept valid currency codes', async () => {
      const validCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD'];

      for (const currency of validCurrencies) {
        mockAdd.mockClear();
        await createEverythingElseBudget(mockFirestore, testUserId, currency);
        const budgetData = mockAdd.mock.calls[0][0];
        expect(budgetData.currency).toBe(currency);
      }
    });
  });

  describe('System Budget Properties', () => {
    test('should set amount to 0 (calculated from spending)', async () => {
      await createEverythingElseBudget(mockFirestore, testUserId, testCurrency);

      const budgetData = mockAdd.mock.calls[0][0];
      expect(budgetData.amount).toBe(0);
    });

    test('should set empty categoryIds (catches all categories)', async () => {
      await createEverythingElseBudget(mockFirestore, testUserId, testCurrency);

      const budgetData = mockAdd.mock.calls[0][0];
      expect(budgetData.categoryIds).toEqual([]);
      expect(Array.isArray(budgetData.categoryIds)).toBe(true);
    });

    test('should set budgetType to recurring', async () => {
      await createEverythingElseBudget(mockFirestore, testUserId, testCurrency);

      const budgetData = mockAdd.mock.calls[0][0];
      expect(budgetData.budgetType).toBe('recurring');
    });

    test('should set isOngoing to true', async () => {
      await createEverythingElseBudget(mockFirestore, testUserId, testCurrency);

      const budgetData = mockAdd.mock.calls[0][0];
      expect(budgetData.isOngoing).toBe(true);
      expect(budgetData.budgetEndDate).toBeUndefined();
    });

    test('should not have description field', async () => {
      await createEverythingElseBudget(mockFirestore, testUserId, testCurrency);

      const budgetData = mockAdd.mock.calls[0][0];
      expect(budgetData.description).toBeUndefined();
    });
  });

  describe('Return Value', () => {
    test('should return the created budget document ID', async () => {
      const budgetId = await createEverythingElseBudget(mockFirestore, testUserId, testCurrency);

      expect(typeof budgetId).toBe('string');
      expect(budgetId).toBe(mockDocId);
      expect(budgetId.length).toBeGreaterThan(0);
    });

    test('should return existing budget ID when duplicate found', async () => {
      const existingId = 'existing-everything-else-budget-id';
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{
          id: existingId,
          data: () => ({
            isSystemEverythingElse: true,
            userId: testUserId
          })
        }]
      });

      const budgetId = await createEverythingElseBudget(mockFirestore, testUserId, testCurrency);

      expect(budgetId).toBe(existingId);
    });
  });

  describe('Real-world Scenarios', () => {
    test('should create budget for new user on signup', async () => {
      const newUserId = 'new-user-signup-xyz';
      const userCurrency = 'USD';

      const budgetId = await createEverythingElseBudget(mockFirestore, newUserId, userCurrency);

      expect(budgetId).toBeTruthy();
      expect(mockAdd).toHaveBeenCalledTimes(1);

      const budgetData = mockAdd.mock.calls[0][0];
      expect(budgetData.userId).toBe(newUserId);
      expect(budgetData.isSystemEverythingElse).toBe(true);
    });

    test('should handle migration for existing user without system budget', async () => {
      const existingUserId = 'existing-user-without-system-budget';

      // First call - no existing budget
      mockGet.mockResolvedValueOnce({
        empty: true,
        docs: []
      });

      const budgetId = await createEverythingElseBudget(mockFirestore, existingUserId, testCurrency);

      expect(budgetId).toBeTruthy();
      expect(mockAdd).toHaveBeenCalledTimes(1);
    });

    test('should respect user currency preference', async () => {
      const userPreferences = [
        { userId: 'user-us', currency: 'USD' },
        { userId: 'user-eu', currency: 'EUR' },
        { userId: 'user-uk', currency: 'GBP' },
        { userId: 'user-jp', currency: 'JPY' }
      ];

      for (const { userId, currency } of userPreferences) {
        mockAdd.mockClear();
        await createEverythingElseBudget(mockFirestore, userId, currency);

        const budgetData = mockAdd.mock.calls[0][0];
        expect(budgetData.userId).toBe(userId);
        expect(budgetData.currency).toBe(currency);
      }
    });
  });

  describe('Integration with Budget Periods', () => {
    test('should create budget that can trigger onBudgetCreate', async () => {
      await createEverythingElseBudget(mockFirestore, testUserId, testCurrency);

      const budgetData = mockAdd.mock.calls[0][0];

      // Should have required fields for period generation
      expect(budgetData.budgetType).toBe('recurring');
      expect(budgetData.period).toBe('monthly');
      expect(budgetData.startDate).toBeInstanceOf(Timestamp);
      expect(budgetData.isOngoing).toBe(true);
      expect(budgetData.isActive).toBe(true);
    });

    test('should set period to monthly for consistent tracking', async () => {
      await createEverythingElseBudget(mockFirestore, testUserId, testCurrency);

      const budgetData = mockAdd.mock.calls[0][0];
      expect(budgetData.period).toBe('monthly');
    });
  });

  describe('Data Structure Compliance', () => {
    test('should follow ResourceOwnership interface', async () => {
      await createEverythingElseBudget(mockFirestore, testUserId, testCurrency);

      const budgetData = mockAdd.mock.calls[0][0];

      // Required ResourceOwnership fields
      expect(budgetData.userId).toBeDefined();
      expect(budgetData.groupIds).toBeDefined();
      expect(budgetData.isActive).toBeDefined();
      expect(budgetData.createdAt).toBeDefined();
      expect(budgetData.updatedAt).toBeDefined();
    });

    test('should follow Budget interface', async () => {
      await createEverythingElseBudget(mockFirestore, testUserId, testCurrency);

      const budgetData = mockAdd.mock.calls[0][0];

      // Required Budget fields
      expect(budgetData.name).toBeDefined();
      expect(budgetData.amount).toBeDefined();
      expect(budgetData.currency).toBeDefined();
      expect(budgetData.categoryIds).toBeDefined();
      expect(budgetData.period).toBeDefined();
      expect(budgetData.startDate).toBeDefined();
      expect(budgetData.spent).toBeDefined();
      expect(budgetData.remaining).toBeDefined();
      expect(budgetData.alertThreshold).toBeDefined();
      expect(budgetData.budgetType).toBeDefined();
      expect(budgetData.isOngoing).toBeDefined();
      expect(budgetData.isSystemEverythingElse).toBeDefined();
    });

    test('should include nested access control object', async () => {
      await createEverythingElseBudget(mockFirestore, testUserId, testCurrency);

      const budgetData = mockAdd.mock.calls[0][0];

      expect(budgetData.access).toBeDefined();
      expect(budgetData.access.ownerId).toBe(testUserId);
      expect(budgetData.access.createdBy).toBe(testUserId);
      expect(budgetData.access.isPrivate).toBe(true);
    });
  });
});
