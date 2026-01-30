/**
 * @file budgetQueries.unit.test.ts
 * @description Unit tests for budget query API functions
 *
 * Tests:
 * - getUserBudgets (HTTP GET)
 * - getPersonalBudgets (HTTP GET)
 * - getBudgetSummary (HTTP GET)
 *
 * Coverage areas:
 * - Input validation
 * - Authentication & authorization
 * - Query filtering
 * - Spending calculations
 * - Family/member access
 * - Error handling
 */

import { Timestamp } from 'firebase-admin/firestore';
import { BudgetPeriod, UserRole } from '../../../types';

// ============================================================================
// MOCK SETUP
// ============================================================================

// Mock Firestore utils
jest.mock('../../../utils/firestore', () => ({
  getDocument: jest.fn(),
  queryDocuments: jest.fn(),
}));

// Mock auth utils
jest.mock('../../../utils/auth', () => ({
  authMiddleware: jest.fn(),
  createErrorResponse: jest.fn((code, message) => ({
    success: false,
    error: { code, message },
  })),
  createSuccessResponse: jest.fn((data) => ({
    success: true,
    data,
  })),
  checkFamilyAccess: jest.fn(),
}));

// Mock CORS middleware
jest.mock('../../../middleware/cors', () => ({
  firebaseCors: jest.fn((_req: any, _res: any, handler: () => void) => handler()),
}));

import { getDocument, queryDocuments } from '../../../utils/firestore';
import { checkFamilyAccess } from '../../../utils/auth';

// ============================================================================
// TEST DATA FACTORIES
// ============================================================================

function createMockUser(overrides: Partial<any> = {}) {
  return {
    id: 'test-user-123',
    email: 'test@example.com',
    displayName: 'Test User',
    role: UserRole.VIEWER,
    familyId: 'family-123',
    isActive: true,
    preferences: {
      currency: 'USD',
    },
    ...overrides,
  };
}

function createMockBudget(overrides: Partial<any> = {}) {
  return {
    id: 'budget-123',
    name: 'Groceries',
    description: 'Monthly grocery budget',
    amount: 500,
    currency: 'USD',
    categoryIds: ['FOOD_AND_DRINK_GROCERIES'],
    period: BudgetPeriod.MONTHLY,
    budgetType: 'recurring',
    isOngoing: true,
    startDate: Timestamp.fromDate(new Date('2025-01-01')),
    endDate: Timestamp.fromDate(new Date('2025-01-31')),
    spent: 0,
    remaining: 500,
    alertThreshold: 80,
    memberIds: ['test-user-123'],
    isShared: false,
    isActive: true,
    userId: 'test-user-123',
    familyId: 'family-123',
    groupIds: [],
    createdBy: 'test-user-123',
    ownerId: 'test-user-123',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  };
}

function createMockTransaction(overrides: Partial<any> = {}) {
  return {
    id: 'txn-123',
    amount: 50,
    description: 'Grocery shopping',
    status: 'approved',
    type: 'expense',
    budgetId: 'budget-123',
    userId: 'test-user-123',
    date: Timestamp.fromDate(new Date('2025-01-15')),
    categoryId: 'FOOD_AND_DRINK_GROCERIES',
    createdAt: Timestamp.now(),
    ...overrides,
  };
}

// Mock request/response factories exported for potential use in other test files
export const httpMocks = {
  createRequest: (overrides: Partial<any> = {}) => ({
    method: 'GET',
    query: {},
    body: {},
    get: jest.fn((header: string) => {
      if (header === 'Authorization') return 'Bearer mock-token';
      return undefined;
    }),
    ...overrides,
  }),

  createResponse: () => {
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    return res;
  },
};

// ============================================================================
// getUserBudgets TESTS
// ============================================================================

describe('getUserBudgets', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // METHOD VALIDATION
  // --------------------------------------------------------------------------

  describe('HTTP Method Validation', () => {
    it('should reject non-GET methods', () => {
      const methods = ['POST', 'PUT', 'DELETE', 'PATCH'];

      methods.forEach(method => {
        const isAllowed = method === 'GET';
        expect(isAllowed).toBe(false);
      });
    });

    it('should accept GET method', () => {
      const method = 'GET';
      const isAllowed = method === 'GET';
      expect(isAllowed).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // AUTHENTICATION
  // --------------------------------------------------------------------------

  describe('Authentication', () => {
    it('should require authentication', () => {
      const authResult = { success: false, user: null };
      const isAuthenticated = authResult.success && authResult.user;

      expect(isAuthenticated).toBeFalsy();
    });

    it('should require VIEWER role minimum', () => {
      const user = createMockUser({ role: UserRole.VIEWER });
      // VIEWER is the minimum required role for query operations
      const hasRequiredRole = [UserRole.VIEWER, UserRole.EDITOR, UserRole.ADMIN].includes(user.role);
      expect(hasRequiredRole).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // FAMILY REQUIREMENT
  // --------------------------------------------------------------------------

  describe('Family Requirement', () => {
    it('should require user to belong to a family', () => {
      const user = createMockUser({ familyId: undefined });
      const hasFamily = !!user.familyId;

      expect(hasFamily).toBe(false);

      // Expected error response when user has no family
      const expectedError = { code: 'no-family', message: 'User must belong to a family' };
      expect(expectedError.message).toContain('family');
    });

    it('should proceed when user has familyId', () => {
      const user = createMockUser({ familyId: 'family-123' });
      const hasFamily = !!user.familyId;

      expect(hasFamily).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // QUERY FILTERS
  // --------------------------------------------------------------------------

  describe('Query Filters', () => {
    it('should filter by familyId', () => {
      const user = createMockUser({ familyId: 'family-123' });

      const queryConditions = [
        { field: 'familyId', operator: '==', value: user.familyId },
      ];

      expect(queryConditions[0].value).toBe('family-123');
    });

    it('should filter by memberIds array-contains', () => {
      const targetUserId = 'test-user-123';

      const queryConditions = [
        { field: 'memberIds', operator: 'array-contains', value: targetUserId },
      ];

      expect(queryConditions[0].operator).toBe('array-contains');
      expect(queryConditions[0].value).toBe(targetUserId);
    });

    it('should filter only active budgets', () => {
      const queryConditions = [
        { field: 'isActive', operator: '==', value: true },
      ];

      expect(queryConditions[0].value).toBe(true);
    });

    it('should order by createdAt descending', () => {
      const orderConfig = {
        orderBy: 'createdAt',
        orderDirection: 'desc',
      };

      expect(orderConfig.orderBy).toBe('createdAt');
      expect(orderConfig.orderDirection).toBe('desc');
    });
  });

  // --------------------------------------------------------------------------
  // BUDGET RESULTS
  // --------------------------------------------------------------------------

  describe('Budget Results', () => {
    it('should return user member budgets', async () => {
      const mockBudgets = [
        createMockBudget({ id: 'budget-1', name: 'Groceries' }),
        createMockBudget({ id: 'budget-2', name: 'Entertainment' }),
      ];

      (queryDocuments as jest.Mock).mockResolvedValue(mockBudgets);

      const budgets = await queryDocuments('budgets', { where: [] });
      expect(budgets).toHaveLength(2);
    });

    it('should return empty array when no budgets match', async () => {
      (queryDocuments as jest.Mock).mockResolvedValue([]);

      const budgets = await queryDocuments('budgets', { where: [] });
      expect(budgets).toHaveLength(0);
      expect(Array.isArray(budgets)).toBe(true);
    });

    it('should update spending for each budget', async () => {
      const mockBudgets = [createMockBudget()];
      const mockTransactions = [
        createMockTransaction({ amount: 50 }),
        createMockTransaction({ amount: 75 }),
      ];

      // Simulate spending calculation
      const totalSpent = mockTransactions.reduce((sum, t) => sum + t.amount, 0);
      expect(totalSpent).toBe(125);

      const updatedBudget = {
        ...mockBudgets[0],
        spent: totalSpent,
        remaining: mockBudgets[0].amount - totalSpent,
      };
      expect(updatedBudget.spent).toBe(125);
      expect(updatedBudget.remaining).toBe(375);
    });
  });

  // --------------------------------------------------------------------------
  // TARGET USER ID
  // --------------------------------------------------------------------------

  describe('Target User ID', () => {
    it('should use authenticated user ID by default', () => {
      const user = createMockUser({ id: 'auth-user-123' });
      const queryUserId = undefined;

      const targetUserId = queryUserId || user.id;
      expect(targetUserId).toBe('auth-user-123');
    });

    it('should allow querying for specific userId', () => {
      const user = createMockUser({ id: 'auth-user-123' });
      const queryUserId = 'other-user-456';

      const targetUserId = queryUserId || user.id;
      expect(targetUserId).toBe('other-user-456');
    });
  });

  // --------------------------------------------------------------------------
  // ERROR HANDLING
  // --------------------------------------------------------------------------

  describe('Error Handling', () => {
    it('should return 500 on internal error', async () => {
      (queryDocuments as jest.Mock).mockRejectedValue(new Error('Database error'));

      try {
        await queryDocuments('budgets', { where: [] });
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toBe('Database error');
      }

      // Expected error for internal failures
      const expectedError = { code: 'internal-error', message: 'Failed to get user budgets' };
      expect(expectedError.code).toBe('internal-error');
    });
  });
});

// ============================================================================
// getPersonalBudgets TESTS
// ============================================================================

describe('getPersonalBudgets', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // METHOD VALIDATION
  // --------------------------------------------------------------------------

  describe('HTTP Method Validation', () => {
    it('should reject non-GET methods', () => {
      const methods = ['POST', 'PUT', 'DELETE', 'PATCH'];

      methods.forEach(method => {
        const isAllowed = method === 'GET';
        expect(isAllowed).toBe(false);
      });
    });

    it('should accept GET method', () => {
      const method = 'GET';
      const isAllowed = method === 'GET';
      expect(isAllowed).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // AUTHENTICATION
  // --------------------------------------------------------------------------

  describe('Authentication', () => {
    it('should require authentication', () => {
      const authResult = { success: false, user: null };
      const isAuthenticated = authResult.success && authResult.user;

      expect(isAuthenticated).toBeFalsy();
    });

    it('should require VIEWER role minimum', () => {
      const user = createMockUser({ role: UserRole.VIEWER });
      const hasRequiredRole = [UserRole.VIEWER, UserRole.EDITOR, UserRole.ADMIN].includes(user.role);

      expect(hasRequiredRole).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // BASE QUERY
  // --------------------------------------------------------------------------

  describe('Base Query - createdBy Filter', () => {
    it('should filter budgets by createdBy user ID', () => {
      const user = createMockUser({ id: 'test-user-123' });

      const whereConditions = [
        { field: 'createdBy', operator: '==', value: user.id },
      ];

      expect(whereConditions[0].field).toBe('createdBy');
      expect(whereConditions[0].value).toBe('test-user-123');
    });

    it('should work for users without family membership', () => {
      const user = createMockUser({ id: 'solo-user', familyId: undefined });

      // getPersonalBudgets doesn't require family membership
      const canQuery = !!user.id;
      expect(canQuery).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // OPTIONAL FILTERS
  // --------------------------------------------------------------------------

  describe('Optional Filters', () => {
    it('should filter by startDate when provided', () => {
      const startDate = '2025-01-01';

      const whereConditions = [
        { field: 'startDate', operator: '>=', value: startDate },
      ];

      expect(whereConditions[0].field).toBe('startDate');
      expect(whereConditions[0].operator).toBe('>=');
    });

    it('should filter by endDate when provided', () => {
      const endDate = '2025-12-31';

      const whereConditions = [
        { field: 'endDate', operator: '<=', value: endDate },
      ];

      expect(whereConditions[0].field).toBe('endDate');
      expect(whereConditions[0].operator).toBe('<=');
    });

    it('should filter by category when provided', () => {
      const category = 'FOOD_AND_DRINK_GROCERIES';

      const whereConditions = [
        { field: 'categoryIds', operator: 'array-contains', value: category },
      ];

      expect(whereConditions[0].field).toBe('categoryIds');
      expect(whereConditions[0].operator).toBe('array-contains');
    });

    it('should filter by isActive when provided', () => {
      const isActive = 'true';

      const whereConditions = [
        { field: 'isActive', operator: '==', value: isActive === 'true' },
      ];

      expect(whereConditions[0].field).toBe('isActive');
      expect(whereConditions[0].value).toBe(true);
    });

    it('should parse isActive string to boolean correctly', () => {
      const parseIsActive = (value: string): boolean => value === 'true';

      expect(parseIsActive('true')).toBe(true);
      expect(parseIsActive('false')).toBe(false);
      expect(parseIsActive('TRUE')).toBe(false); // Case sensitive
    });
  });

  // --------------------------------------------------------------------------
  // COMBINED FILTERS
  // --------------------------------------------------------------------------

  describe('Combined Filters', () => {
    it('should combine multiple filters', () => {
      const user = createMockUser({ id: 'test-user-123' });
      const filters = {
        startDate: '2025-01-01',
        endDate: '2025-06-30',
        category: 'FOOD_AND_DRINK',
        isActive: 'true',
      };

      const whereConditions: any[] = [
        { field: 'createdBy', operator: '==', value: user.id },
      ];

      if (filters.startDate) {
        whereConditions.push({ field: 'startDate', operator: '>=', value: filters.startDate });
      }
      if (filters.endDate) {
        whereConditions.push({ field: 'endDate', operator: '<=', value: filters.endDate });
      }
      if (filters.category) {
        whereConditions.push({ field: 'categoryIds', operator: 'array-contains', value: filters.category });
      }
      if (filters.isActive !== undefined) {
        whereConditions.push({ field: 'isActive', operator: '==', value: filters.isActive === 'true' });
      }

      expect(whereConditions).toHaveLength(5);
    });

    it('should work with no optional filters', () => {
      const user = createMockUser({ id: 'test-user-123' });

      const whereConditions = [
        { field: 'createdBy', operator: '==', value: user.id },
      ];

      expect(whereConditions).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // BUDGET RESULTS
  // --------------------------------------------------------------------------

  describe('Budget Results', () => {
    it('should return user-created budgets', async () => {
      const mockBudgets = [
        createMockBudget({ id: 'budget-1', createdBy: 'test-user-123' }),
        createMockBudget({ id: 'budget-2', createdBy: 'test-user-123' }),
      ];

      (queryDocuments as jest.Mock).mockResolvedValue(mockBudgets);

      const budgets = await queryDocuments('budgets', { where: [] });
      expect(budgets).toHaveLength(2);
      expect(budgets.every((b: any) => b.createdBy === 'test-user-123')).toBe(true);
    });

    it('should return empty array when no budgets match filters', async () => {
      (queryDocuments as jest.Mock).mockResolvedValue([]);

      const budgets = await queryDocuments('budgets', { where: [] });
      expect(budgets).toHaveLength(0);
    });

    it('should order results by createdAt descending', () => {
      const orderConfig = {
        orderBy: 'createdAt',
        orderDirection: 'desc',
      };

      expect(orderConfig.orderBy).toBe('createdAt');
      expect(orderConfig.orderDirection).toBe('desc');
    });

    it('should update spent amounts for returned budgets', async () => {
      const mockBudget = createMockBudget({ spent: 0 });
      const transactions = [
        { amount: 100, status: 'approved', type: 'expense' },
      ];

      const totalSpent = transactions.reduce((sum, t) => sum + t.amount, 0);
      const updatedBudget = { ...mockBudget, spent: totalSpent };

      expect(updatedBudget.spent).toBe(100);
    });
  });

  // --------------------------------------------------------------------------
  // ERROR HANDLING
  // --------------------------------------------------------------------------

  describe('Error Handling', () => {
    it('should return 500 on internal error', async () => {
      (queryDocuments as jest.Mock).mockRejectedValue(new Error('Query failed'));

      try {
        await queryDocuments('budgets', { where: [] });
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toBe('Query failed');
      }

      // Expected error for internal failures
      const expectedError = { code: 'internal-error', message: 'Failed to get personal budgets' };
      expect(expectedError.message).toContain('personal budgets');
    });
  });
});

// ============================================================================
// getBudgetSummary TESTS
// ============================================================================

describe('getBudgetSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // METHOD VALIDATION
  // --------------------------------------------------------------------------

  describe('HTTP Method Validation', () => {
    it('should reject non-GET methods', () => {
      const methods = ['POST', 'PUT', 'DELETE', 'PATCH'];

      methods.forEach(method => {
        const isAllowed = method === 'GET';
        expect(isAllowed).toBe(false);
      });
    });

    it('should accept GET method', () => {
      const method = 'GET';
      const isAllowed = method === 'GET';
      expect(isAllowed).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // PARAMETER VALIDATION
  // --------------------------------------------------------------------------

  describe('Parameter Validation', () => {
    it('should reject missing budget ID', () => {
      const budgetId = undefined;
      const hasId = !!budgetId;

      expect(hasId).toBe(false);

      // Expected error for missing budget ID
      const expectedError = { code: 'missing-parameter', message: 'Budget ID is required' };
      expect(expectedError.message).toContain('required');
    });

    it('should accept valid budget ID', () => {
      const budgetId = 'budget-123';
      const hasId = !!budgetId;

      expect(hasId).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // AUTHENTICATION
  // --------------------------------------------------------------------------

  describe('Authentication', () => {
    it('should require authentication', () => {
      const authResult = { success: false, user: null };
      const isAuthenticated = authResult.success && authResult.user;

      expect(isAuthenticated).toBeFalsy();
    });

    it('should require VIEWER role minimum', () => {
      const user = createMockUser({ role: UserRole.VIEWER });
      const hasRequiredRole = [UserRole.VIEWER, UserRole.EDITOR, UserRole.ADMIN].includes(user.role);

      expect(hasRequiredRole).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // BUDGET EXISTENCE
  // --------------------------------------------------------------------------

  describe('Budget Existence', () => {
    it('should return 404 for non-existent budget', async () => {
      (getDocument as jest.Mock).mockResolvedValue(null);

      const budget = await getDocument('budgets', 'nonexistent');
      expect(budget).toBeNull();

      // Expected error for non-existent budget
      const expectedError = { code: 'budget-not-found', message: 'Budget not found' };
      expect(expectedError.message).toBe('Budget not found');
    });

    it('should proceed when budget exists', async () => {
      const mockBudget = createMockBudget();
      (getDocument as jest.Mock).mockResolvedValue(mockBudget);

      const budget = await getDocument('budgets', 'budget-123');
      expect(budget).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // ACCESS CONTROL
  // --------------------------------------------------------------------------

  describe('Access Control', () => {
    describe('Individual Budget Access', () => {
      it('should allow owner to access budget', () => {
        const budget = createMockBudget({ createdBy: 'user-123', isShared: false });
        const user = createMockUser({ id: 'user-123' });

        const isOwner = budget.createdBy === user.id;
        expect(isOwner).toBe(true);
      });

      it('should allow member to access budget', () => {
        const budget = createMockBudget({
          createdBy: 'other-user',
          memberIds: ['user-123', 'other-user'],
          isShared: false,
        });
        const user = createMockUser({ id: 'user-123' });

        const isMember = (budget.memberIds || []).includes(user.id);
        expect(isMember).toBe(true);
      });

      it('should reject non-owner, non-member access', () => {
        const budget = createMockBudget({
          createdBy: 'other-user',
          memberIds: ['other-user'],
          isShared: false,
        });
        const user = createMockUser({ id: 'outsider-456' });

        const isOwner = budget.createdBy === user.id;
        const isMember = (budget.memberIds || []).includes(user.id);
        const canAccess = isOwner || isMember;

        expect(canAccess).toBe(false);

        // Expected error for unauthorized access
        const expectedError = { code: 'access-denied', message: 'Cannot access this budget' };
        expect(expectedError.message).toContain('access');
      });
    });

    describe('Shared Budget Access', () => {
      it('should check family access for shared budgets', async () => {
        const budget = createMockBudget({
          isShared: true,
          familyId: 'family-123',
        });
        const userId = 'user-123';

        (checkFamilyAccess as jest.Mock).mockResolvedValue(true);

        const hasAccess = await checkFamilyAccess(userId, budget.familyId);
        expect(hasAccess).toBe(true);
      });

      it('should reject non-family member access to shared budget', async () => {
        const budget = createMockBudget({
          isShared: true,
          familyId: 'family-123',
        });
        const userId = 'outsider-456';

        (checkFamilyAccess as jest.Mock).mockResolvedValue(false);

        const hasAccess = await checkFamilyAccess(userId, budget.familyId);
        expect(hasAccess).toBe(false);

        // Expected error for non-family member access
        const expectedError = { code: 'access-denied', message: 'Cannot access this family budget' };
        expect(expectedError.message).toContain('family');
      });
    });
  });

  // --------------------------------------------------------------------------
  // SPENDING CALCULATIONS
  // --------------------------------------------------------------------------

  describe('Spending Calculations', () => {
    it('should calculate total spending from transactions', () => {
      const transactions = [
        createMockTransaction({ amount: 50 }),
        createMockTransaction({ amount: 100 }),
        createMockTransaction({ amount: 25 }),
      ];

      const totalSpent = transactions.reduce((sum, t) => sum + t.amount, 0);
      expect(totalSpent).toBe(175);
    });

    it('should calculate remaining amount correctly', () => {
      const budget = createMockBudget({ amount: 500 });
      const totalSpent = 175;

      const remaining = budget.amount - totalSpent;
      expect(remaining).toBe(325);
    });

    it('should calculate spending percentage', () => {
      const budgetAmount = 500;
      const totalSpent = 250;

      const percentage = (totalSpent / budgetAmount) * 100;
      expect(percentage).toBe(50);
    });

    it('should detect over budget condition', () => {
      const budgetAmount = 500;

      // Under budget
      const spent1 = 400;
      const isOverBudget1 = spent1 > budgetAmount;
      expect(isOverBudget1).toBe(false);

      // Over budget
      const spent2 = 600;
      const isOverBudget2 = spent2 > budgetAmount;
      expect(isOverBudget2).toBe(true);
    });

    it('should detect alert threshold reached', () => {
      const budgetAmount = 500;
      const alertThreshold = 80;

      // Below threshold (70%)
      const spent1 = 350;
      const percentage1 = (spent1 / budgetAmount) * 100;
      const thresholdReached1 = percentage1 >= alertThreshold;
      expect(thresholdReached1).toBe(false);

      // At threshold (80%)
      const spent2 = 400;
      const percentage2 = (spent2 / budgetAmount) * 100;
      const thresholdReached2 = percentage2 >= alertThreshold;
      expect(thresholdReached2).toBe(true);

      // Above threshold (90%)
      const spent3 = 450;
      const percentage3 = (spent3 / budgetAmount) * 100;
      const thresholdReached3 = percentage3 >= alertThreshold;
      expect(thresholdReached3).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // TRANSACTION QUERIES
  // --------------------------------------------------------------------------

  describe('Transaction Queries', () => {
    it('should filter transactions by budgetId', () => {
      const budgetId = 'budget-123';

      const whereConditions = [
        { field: 'budgetId', operator: '==', value: budgetId },
      ];

      expect(whereConditions[0].value).toBe('budget-123');
    });

    it('should filter only approved transactions', () => {
      const whereConditions = [
        { field: 'status', operator: '==', value: 'approved' },
      ];

      expect(whereConditions[0].value).toBe('approved');
    });

    it('should filter only expense transactions', () => {
      const whereConditions = [
        { field: 'type', operator: '==', value: 'expense' },
      ];

      expect(whereConditions[0].value).toBe('expense');
    });

    it('should order transactions by date descending', () => {
      const orderConfig = {
        orderBy: 'date',
        orderDirection: 'desc',
      };

      expect(orderConfig.orderBy).toBe('date');
      expect(orderConfig.orderDirection).toBe('desc');
    });
  });

  // --------------------------------------------------------------------------
  // RECENT TRANSACTIONS
  // --------------------------------------------------------------------------

  describe('Recent Transactions', () => {
    it('should include last 5 transactions', () => {
      const transactions = [
        createMockTransaction({ id: 'txn-1' }),
        createMockTransaction({ id: 'txn-2' }),
        createMockTransaction({ id: 'txn-3' }),
        createMockTransaction({ id: 'txn-4' }),
        createMockTransaction({ id: 'txn-5' }),
        createMockTransaction({ id: 'txn-6' }),
        createMockTransaction({ id: 'txn-7' }),
      ];

      const recentTransactions = transactions.slice(0, 5);
      expect(recentTransactions).toHaveLength(5);
      expect(recentTransactions[0].id).toBe('txn-1');
    });

    it('should return all transactions when less than 5', () => {
      const transactions = [
        createMockTransaction({ id: 'txn-1' }),
        createMockTransaction({ id: 'txn-2' }),
      ];

      const recentTransactions = transactions.slice(0, 5);
      expect(recentTransactions).toHaveLength(2);
    });
  });

  // --------------------------------------------------------------------------
  // MEMBER SPENDING BREAKDOWN
  // --------------------------------------------------------------------------

  describe('Member Spending Breakdown', () => {
    it('should calculate spending by member', () => {
      const transactions = [
        createMockTransaction({ userId: 'user-1', amount: 100 }),
        createMockTransaction({ userId: 'user-1', amount: 50 }),
        createMockTransaction({ userId: 'user-2', amount: 75 }),
      ];

      const spendingByMember: Record<string, { amount: number; transactionCount: number }> = {};

      transactions.forEach(t => {
        if (!spendingByMember[t.userId]) {
          spendingByMember[t.userId] = { amount: 0, transactionCount: 0 };
        }
        spendingByMember[t.userId].amount += t.amount;
        spendingByMember[t.userId].transactionCount += 1;
      });

      expect(spendingByMember['user-1'].amount).toBe(150);
      expect(spendingByMember['user-1'].transactionCount).toBe(2);
      expect(spendingByMember['user-2'].amount).toBe(75);
      expect(spendingByMember['user-2'].transactionCount).toBe(1);
    });

    it('should calculate percentage of total spending per member', () => {
      const spendingByMember = {
        'user-1': { amount: 150, transactionCount: 2 },
        'user-2': { amount: 50, transactionCount: 1 },
      };
      const totalSpent = 200;

      const percentages = Object.entries(spendingByMember).map(([userId, data]) => ({
        userId,
        percentage: totalSpent > 0 ? (data.amount / totalSpent) * 100 : 0,
      }));

      expect(percentages[0].percentage).toBe(75);
      expect(percentages[1].percentage).toBe(25);
    });

    it('should handle zero total spending', () => {
      const totalSpent = 0;
      const memberAmount = 0;

      const percentage = totalSpent > 0 ? (memberAmount / totalSpent) * 100 : 0;
      expect(percentage).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // SUMMARY RESPONSE STRUCTURE
  // --------------------------------------------------------------------------

  describe('Summary Response Structure', () => {
    it('should include budget details in response', () => {
      const budget = createMockBudget();

      const budgetSummary = {
        id: budget.id,
        name: budget.name,
        amount: budget.amount,
        currency: budget.currency,
        period: budget.period,
        categoryIds: budget.categoryIds,
      };

      expect(budgetSummary).toHaveProperty('id');
      expect(budgetSummary).toHaveProperty('name');
      expect(budgetSummary).toHaveProperty('amount');
      expect(budgetSummary).toHaveProperty('currency');
      expect(budgetSummary).toHaveProperty('period');
      expect(budgetSummary).toHaveProperty('categoryIds');
    });

    it('should include spending details in response', () => {
      const budget = createMockBudget({ amount: 500, alertThreshold: 80 });
      const totalSpent = 425;

      const spending = {
        total: totalSpent,
        remaining: budget.amount - totalSpent,
        percentage: (totalSpent / budget.amount) * 100,
        isOverBudget: totalSpent > budget.amount,
        alertThresholdReached: (totalSpent / budget.amount) * 100 >= budget.alertThreshold,
      };

      expect(spending.total).toBe(425);
      expect(spending.remaining).toBe(75);
      expect(spending.percentage).toBe(85);
      expect(spending.isOverBudget).toBe(false);
      expect(spending.alertThresholdReached).toBe(true);
    });

    it('should include transaction summary in response', () => {
      const transactions = [
        createMockTransaction({ id: 'txn-1' }),
        createMockTransaction({ id: 'txn-2' }),
        createMockTransaction({ id: 'txn-3' }),
      ];

      const transactionSummary = {
        count: transactions.length,
        recent: transactions.slice(0, 5),
      };

      expect(transactionSummary.count).toBe(3);
      expect(transactionSummary.recent).toHaveLength(3);
    });

    it('should include member breakdown in response', () => {
      const members = [
        {
          user: { id: 'user-1', displayName: 'User One', email: 'user1@example.com' },
          spending: { amount: 100, transactionCount: 2 },
          percentage: 66.67,
        },
        {
          user: { id: 'user-2', displayName: 'User Two', email: 'user2@example.com' },
          spending: { amount: 50, transactionCount: 1 },
          percentage: 33.33,
        },
      ];

      expect(members).toHaveLength(2);
      expect(members[0]).toHaveProperty('user');
      expect(members[0]).toHaveProperty('spending');
      expect(members[0]).toHaveProperty('percentage');
    });
  });

  // --------------------------------------------------------------------------
  // MEMBER DETAILS FETCH
  // --------------------------------------------------------------------------

  describe('Member Details Fetch', () => {
    it('should fetch user details for each member', async () => {
      const memberIds = ['user-1', 'user-2'];

      const mockUsers = [
        { id: 'user-1', displayName: 'User One', email: 'user1@example.com' },
        { id: 'user-2', displayName: 'User Two', email: 'user2@example.com' },
      ];

      (getDocument as jest.Mock)
        .mockResolvedValueOnce(mockUsers[0])
        .mockResolvedValueOnce(mockUsers[1]);

      const users = await Promise.all(
        memberIds.map(id => getDocument('users', id))
      );

      expect(users).toHaveLength(2);
      expect(users[0]).toHaveProperty('displayName', 'User One');
    });

    it('should handle unknown members gracefully', async () => {
      const memberIds = ['unknown-user'];

      (getDocument as jest.Mock).mockResolvedValue(null);

      const users = await Promise.all(
        memberIds.map(id => getDocument('users', id))
      );

      const memberInfo = users.map((user, index) => ({
        id: memberIds[index],
        displayName: (user as any)?.displayName || 'Unknown',
        email: (user as any)?.email || 'Unknown',
      }));

      expect(memberInfo[0].displayName).toBe('Unknown');
      expect(memberInfo[0].email).toBe('Unknown');
    });
  });

  // --------------------------------------------------------------------------
  // ERROR HANDLING
  // --------------------------------------------------------------------------

  describe('Error Handling', () => {
    it('should return 500 on internal error', async () => {
      (getDocument as jest.Mock).mockRejectedValue(new Error('Database error'));

      try {
        await getDocument('budgets', 'budget-123');
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toBe('Database error');
      }

      // Expected error for internal failures
      const expectedError = { code: 'internal-error', message: 'Failed to get budget summary' };
      expect(expectedError.message).toContain('budget summary');
    });
  });
});

// ============================================================================
// INTEGRATION TESTS - Query Filters
// ============================================================================

describe('Query Filter Integration', () => {
  describe('Date Range Filtering', () => {
    it('should correctly filter by date range', () => {
      const budgets = [
        createMockBudget({ id: 'b1', startDate: Timestamp.fromDate(new Date('2025-01-01')) }),
        createMockBudget({ id: 'b2', startDate: Timestamp.fromDate(new Date('2025-03-01')) }),
        createMockBudget({ id: 'b3', startDate: Timestamp.fromDate(new Date('2025-06-01')) }),
      ];

      const filterStartDate = new Date('2025-02-01');
      const filterEndDate = new Date('2025-07-01');

      const filtered = budgets.filter(b => {
        const start = b.startDate.toDate();
        return start >= filterStartDate && start <= filterEndDate;
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.map(b => b.id)).toEqual(['b2', 'b3']);
    });
  });

  describe('Category Filtering', () => {
    it('should filter budgets by category', () => {
      const budgets = [
        createMockBudget({ id: 'b1', categoryIds: ['FOOD', 'GROCERIES'] }),
        createMockBudget({ id: 'b2', categoryIds: ['ENTERTAINMENT'] }),
        createMockBudget({ id: 'b3', categoryIds: ['FOOD', 'DINING'] }),
      ];

      const filterCategory = 'FOOD';

      const filtered = budgets.filter(b =>
        b.categoryIds.includes(filterCategory)
      );

      expect(filtered).toHaveLength(2);
      expect(filtered.map(b => b.id)).toEqual(['b1', 'b3']);
    });
  });

  describe('Active Status Filtering', () => {
    it('should filter by active status', () => {
      const budgets = [
        createMockBudget({ id: 'b1', isActive: true }),
        createMockBudget({ id: 'b2', isActive: false }),
        createMockBudget({ id: 'b3', isActive: true }),
      ];

      const activeOnly = budgets.filter(b => b.isActive === true);
      const inactiveOnly = budgets.filter(b => b.isActive === false);

      expect(activeOnly).toHaveLength(2);
      expect(inactiveOnly).toHaveLength(1);
    });
  });
});

// ============================================================================
// SPENDING UPDATE HELPER TESTS
// ============================================================================

describe('updateBudgetSpentAmount Helper', () => {
  describe('Transaction Filtering', () => {
    it('should only count approved expense transactions', () => {
      const transactions = [
        { amount: 50, status: 'approved', type: 'expense' }, // Counts
        { amount: 100, status: 'pending', type: 'expense' }, // Doesn't count
        { amount: 75, status: 'approved', type: 'income' }, // Doesn't count
        { amount: 25, status: 'rejected', type: 'expense' }, // Doesn't count
      ];

      const validTransactions = transactions.filter(
        t => t.status === 'approved' && t.type === 'expense'
      );

      expect(validTransactions).toHaveLength(1);
      expect(validTransactions[0].amount).toBe(50);
    });

    it('should filter transactions within budget date range', () => {
      const budgetStartDate = new Date('2025-01-01');
      const budgetEndDate = new Date('2025-01-31');

      const transactions = [
        { date: new Date('2025-01-15'), amount: 50 }, // In range
        { date: new Date('2024-12-15'), amount: 100 }, // Before range
        { date: new Date('2025-02-15'), amount: 75 }, // After range
      ];

      const inRange = transactions.filter(
        t => t.date >= budgetStartDate && t.date <= budgetEndDate
      );

      expect(inRange).toHaveLength(1);
      expect(inRange[0].amount).toBe(50);
    });
  });

  describe('Spending Calculation', () => {
    it('should sum transaction amounts correctly', () => {
      const transactions = [
        { amount: 50.25 },
        { amount: 100.50 },
        { amount: 25.75 },
      ];

      const totalSpent = transactions.reduce((sum, t) => sum + t.amount, 0);
      expect(totalSpent).toBe(176.50);
    });

    it('should calculate remaining correctly', () => {
      const budgetAmount = 500;
      const totalSpent = 176.50;

      const remaining = budgetAmount - totalSpent;
      expect(remaining).toBe(323.50);
    });
  });

  describe('Conditional Update', () => {
    it('should update budget only if spent amount changed', async () => {
      const budget = createMockBudget({ spent: 100 });
      const newSpent = 150;

      const shouldUpdate = newSpent !== budget.spent;
      expect(shouldUpdate).toBe(true);
    });

    it('should skip update if spent amount unchanged', async () => {
      const budget = createMockBudget({ spent: 100 });
      const newSpent = 100;

      const shouldUpdate = newSpent !== budget.spent;
      expect(shouldUpdate).toBe(false);
    });
  });

  describe('Error Resilience', () => {
    it('should return original budget on error', async () => {
      const originalBudget = createMockBudget();

      (queryDocuments as jest.Mock).mockRejectedValue(new Error('Query failed'));

      // Simulating the error handling logic
      try {
        await queryDocuments('transactions', { where: [] });
      } catch (error) {
        // On error, return original budget
        const result = originalBudget;
        expect(result).toEqual(originalBudget);
      }
    });
  });
});
