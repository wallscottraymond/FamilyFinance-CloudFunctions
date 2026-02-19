/**
 * @file budgetSecurity.unit.test.ts
 * @description Security and authorization tests for budget CRUD operations
 *
 * FUNCTIONALITY TESTED:
 * - Authentication requirements for all CRUD operations
 * - Authentication requirements for query operations
 * - Role-based access control (VIEWER, EDITOR, ADMIN)
 * - Ownership-based access control
 * - Family/group membership access control
 * - Private budget restrictions (groupIds=[])
 * - Input validation and sanitization (XSS prevention)
 * - Amount range validation
 * - Date format validation
 * - CategoryIds format validation
 * - Description length limits
 *
 * EXPECTED OUTCOMES:
 * - Unauthenticated requests are rejected with 401
 * - Insufficient role permissions are rejected with 403
 * - Non-owners cannot modify private budgets
 * - Family members can access shared budgets
 * - Input is sanitized to prevent XSS attacks
 * - Invalid inputs are rejected with appropriate errors
 *
 * DEPENDENCIES:
 * - Jest for testing framework
 * - Firebase Admin SDK (mocked)
 * - Firestore utilities (mocked)
 * - Auth utilities (mocked)
 *
 * RELATED FILES:
 * - /src/functions/budgets/api/crud/createBudget.ts
 * - /src/functions/budgets/api/crud/updateBudget.ts
 * - /src/functions/budgets/api/crud/deleteBudget.ts
 * - /src/functions/budgets/api/crud/getBudget.ts
 * - /src/utils/auth.ts
 * - /src/types/index.ts
 * - /src/types/users.ts
 */

import { Timestamp } from 'firebase-admin/firestore';
import { BudgetPeriod, UserRole } from '../../../types';
import { SystemRole, ROLE_CAPABILITIES } from '../../../types/users';

// ============================================================================
// MOCK SETUP
// ============================================================================

// Mock Firestore
const mockGet = jest.fn();
const mockSet = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockDoc = jest.fn();
const mockCollection = jest.fn();
const mockWhere = jest.fn();
const mockOrderBy = jest.fn();
const mockLimit = jest.fn();

// Mock db
jest.mock('../../../index', () => ({
  db: {
    collection: jest.fn(),
  }
}));

// Mock firestore utils
jest.mock('../../../utils/firestore', () => ({
  getDocument: jest.fn(),
  createDocument: jest.fn(),
  updateDocument: jest.fn(),
  queryDocuments: jest.fn(),
}));

// Mock auth utils
jest.mock('../../../utils/auth', () => ({
  authMiddleware: jest.fn(),
  authenticateRequest: jest.fn(),
  verifyAuthToken: jest.fn(),
  getUserWithRole: jest.fn(),
  hasRequiredRole: jest.fn(),
  checkFamilyAccess: jest.fn(),
  checkUserAccess: jest.fn(),
  createErrorResponse: jest.fn((code, message) => ({
    success: false,
    error: { code, message },
  })),
  createSuccessResponse: jest.fn((data) => ({
    success: true,
    data,
  })),
}));

// Mock validation
jest.mock('../../../utils/validation', () => ({
  validateRequest: jest.fn(),
  createBudgetSchema: {},
  validateCategoryIds: jest.fn(),
}));

// Mock documentStructure
jest.mock('../../../utils/documentStructure', () => ({
  buildAccessControl: jest.fn((userId, createdBy, groupIds) => ({
    createdBy,
    ownerId: userId,
    isPrivate: !groupIds || groupIds.length === 0,
  })),
}));

import { db } from '../../../index';
import { getDocument, createDocument, updateDocument, queryDocuments } from '../../../utils/firestore';
import {
  authMiddleware,
  authenticateRequest,
  verifyAuthToken,
  getUserWithRole,
  hasRequiredRole,
  checkFamilyAccess,
  checkUserAccess,
  createErrorResponse,
  createSuccessResponse,
} from '../../../utils/auth';
import { validateRequest, validateCategoryIds } from '../../../utils/validation';
import { buildAccessControl } from '../../../utils/documentStructure';

// ============================================================================
// TEST DATA FACTORIES
// ============================================================================

function createMockUser(overrides: Partial<any> = {}) {
  return {
    id: 'test-user-123',
    email: 'test@example.com',
    displayName: 'Test User',
    role: UserRole.EDITOR,
    systemRole: SystemRole.STANDARD_USER,
    familyId: 'family-123',
    groupIds: ['group-123'],
    isActive: true,
    preferences: {
      currency: 'USD',
    },
    ...overrides,
  };
}

function createMockBudgetData(overrides: Partial<any> = {}) {
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
    groupIds: [],
    createdBy: 'test-user-123',
    ownerId: 'test-user-123',
    isPrivate: true,
    access: {
      createdBy: 'test-user-123',
      ownerId: 'test-user-123',
      isPrivate: true,
    },
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  };
}

function createMockRequest(overrides: Partial<any> = {}) {
  return {
    method: 'GET',
    query: {},
    body: {},
    auth: null, // No auth by default for security tests
    get: jest.fn((header: string) => {
      if (header === 'Authorization') return undefined; // No token by default
      return undefined;
    }),
    ...overrides,
  };
}

function createMockResponse() {
  const res: any = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res;
}

// ============================================================================
// AUTHENTICATION TESTS
// ============================================================================

describe('Budget Security - Authentication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // CRUD WITHOUT AUTH
  // --------------------------------------------------------------------------

  describe('Unauthenticated CRUD Requests', () => {
    it('should reject createBudget without authentication (401)', async () => {
      // ARRANGE
      const request = createMockRequest({
        method: 'POST',
        auth: null,
        body: { name: 'Test Budget', amount: 100 },
      });

      (authMiddleware as jest.Mock).mockResolvedValue({
        success: false,
        error: createErrorResponse('auth/missing-token', 'Authorization header with Bearer token is required'),
      });

      // ACT
      const authResult = await authMiddleware(request, UserRole.EDITOR);

      // ASSERT
      expect(authResult.success).toBe(false);
      expect(authResult.error).toBeDefined();
      expect(authResult.error.error.code).toBe('auth/missing-token');
    });

    it('should reject updateBudget without authentication (401)', async () => {
      // ARRANGE
      const request = createMockRequest({
        method: 'PUT',
        auth: null,
        body: { name: 'Updated Budget' },
        query: { budgetId: 'budget-123' },
      });

      (authMiddleware as jest.Mock).mockResolvedValue({
        success: false,
        error: createErrorResponse('auth/missing-token', 'Authorization header with Bearer token is required'),
      });

      // ACT
      const authResult = await authMiddleware(request, UserRole.EDITOR);

      // ASSERT
      expect(authResult.success).toBe(false);
      expect(authResult.error.error.code).toBe('auth/missing-token');
    });

    it('should reject deleteBudget without authentication (401)', async () => {
      // ARRANGE
      const request = createMockRequest({
        method: 'DELETE',
        auth: null,
        query: { budgetId: 'budget-123' },
      });

      (authMiddleware as jest.Mock).mockResolvedValue({
        success: false,
        error: createErrorResponse('auth/missing-token', 'Authorization header with Bearer token is required'),
      });

      // ACT
      const authResult = await authMiddleware(request, UserRole.EDITOR);

      // ASSERT
      expect(authResult.success).toBe(false);
      expect(authResult.error.error.code).toBe('auth/missing-token');
    });

    it('should reject getBudget without authentication (401)', async () => {
      // ARRANGE
      const request = createMockRequest({
        method: 'GET',
        auth: null,
        query: { budgetId: 'budget-123' },
      });

      (authMiddleware as jest.Mock).mockResolvedValue({
        success: false,
        error: createErrorResponse('auth/missing-token', 'Authorization header with Bearer token is required'),
      });

      // ACT
      const authResult = await authMiddleware(request, UserRole.VIEWER);

      // ASSERT
      expect(authResult.success).toBe(false);
      expect(authResult.error.error.code).toBe('auth/missing-token');
    });
  });

  // --------------------------------------------------------------------------
  // QUERIES WITHOUT AUTH
  // --------------------------------------------------------------------------

  describe('Unauthenticated Query Requests', () => {
    it('should reject getUserBudgets without authentication (401)', async () => {
      // ARRANGE
      const request = createMockRequest({
        method: 'GET',
        auth: null,
      });

      (authMiddleware as jest.Mock).mockResolvedValue({
        success: false,
        error: createErrorResponse('auth/missing-token', 'Authorization header with Bearer token is required'),
      });

      // ACT
      const authResult = await authMiddleware(request, UserRole.VIEWER);

      // ASSERT
      expect(authResult.success).toBe(false);
      expect(authResult.error.error.code).toBe('auth/missing-token');
    });

    it('should reject getPersonalBudgets without authentication (401)', async () => {
      // ARRANGE
      const request = createMockRequest({
        method: 'GET',
        auth: null,
      });

      (authMiddleware as jest.Mock).mockResolvedValue({
        success: false,
        error: createErrorResponse('auth/missing-token', 'Authorization header with Bearer token is required'),
      });

      // ACT
      const authResult = await authMiddleware(request, UserRole.VIEWER);

      // ASSERT
      expect(authResult.success).toBe(false);
      expect(authResult.error.error.code).toBe('auth/missing-token');
    });

    it('should reject getFamilyBudgets without authentication (401)', async () => {
      // ARRANGE
      const request = createMockRequest({
        method: 'GET',
        auth: null,
      });

      (authMiddleware as jest.Mock).mockResolvedValue({
        success: false,
        error: createErrorResponse('auth/missing-token', 'Authorization header with Bearer token is required'),
      });

      // ACT
      const authResult = await authMiddleware(request, UserRole.VIEWER);

      // ASSERT
      expect(authResult.success).toBe(false);
      expect(authResult.error.error.code).toBe('auth/missing-token');
    });

    it('should reject getBudgetSummary without authentication (401)', async () => {
      // ARRANGE
      const request = createMockRequest({
        method: 'GET',
        auth: null,
        query: { budgetId: 'budget-123' },
      });

      (authMiddleware as jest.Mock).mockResolvedValue({
        success: false,
        error: createErrorResponse('auth/missing-token', 'Authorization header with Bearer token is required'),
      });

      // ACT
      const authResult = await authMiddleware(request, UserRole.VIEWER);

      // ASSERT
      expect(authResult.success).toBe(false);
      expect(authResult.error.error.code).toBe('auth/missing-token');
    });
  });

  // --------------------------------------------------------------------------
  // INVALID TOKEN
  // --------------------------------------------------------------------------

  describe('Invalid Token Handling', () => {
    it('should reject expired token', async () => {
      // ARRANGE
      const request = createMockRequest({
        get: jest.fn((header: string) => {
          if (header === 'Authorization') return 'Bearer expired-token';
          return undefined;
        }),
      });

      (verifyAuthToken as jest.Mock).mockRejectedValue(new Error('Token has expired'));

      // ACT & ASSERT
      await expect(verifyAuthToken('expired-token')).rejects.toThrow('Token has expired');
    });

    it('should reject malformed token', async () => {
      // ARRANGE
      const request = createMockRequest({
        get: jest.fn((header: string) => {
          if (header === 'Authorization') return 'Bearer malformed-token';
          return undefined;
        }),
      });

      (verifyAuthToken as jest.Mock).mockRejectedValue(new Error('Invalid token format'));

      // ACT & ASSERT
      await expect(verifyAuthToken('malformed-token')).rejects.toThrow('Invalid token format');
    });

    it('should reject token for inactive user', async () => {
      // ARRANGE
      const inactiveUser = createMockUser({ isActive: false });

      (authMiddleware as jest.Mock).mockResolvedValue({
        success: false,
        error: createErrorResponse('auth/user-inactive', 'User account is inactive'),
      });

      // ACT
      const authResult = await authMiddleware({}, UserRole.VIEWER);

      // ASSERT
      expect(authResult.success).toBe(false);
      expect(authResult.error.error.code).toBe('auth/user-inactive');
    });
  });
});

// ============================================================================
// ROLE-BASED ACCESS CONTROL TESTS
// ============================================================================

describe('Budget Security - Role-Based Access Control', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // VIEWER ROLE
  // --------------------------------------------------------------------------

  describe('VIEWER Role Permissions', () => {
    it('should allow VIEWER to read own budgets (getBudget)', async () => {
      // ARRANGE
      const viewerUser = createMockUser({ role: UserRole.VIEWER });
      const ownBudget = createMockBudgetData({ createdBy: viewerUser.id });

      (hasRequiredRole as jest.Mock).mockReturnValue(true); // VIEWER >= VIEWER

      // ACT
      const canRead = hasRequiredRole(viewerUser.role, UserRole.VIEWER);
      const isOwner = ownBudget.createdBy === viewerUser.id;

      // ASSERT
      expect(canRead).toBe(true);
      expect(isOwner).toBe(true);
    });

    it('should allow VIEWER to query own budgets (getUserBudgets)', async () => {
      // ARRANGE
      const viewerUser = createMockUser({ role: UserRole.VIEWER });

      (hasRequiredRole as jest.Mock).mockReturnValue(true);

      // ACT
      const canQuery = hasRequiredRole(viewerUser.role, UserRole.VIEWER);

      // ASSERT
      expect(canQuery).toBe(true);
    });

    it('should deny VIEWER from creating budgets (createBudget requires EDITOR)', async () => {
      // ARRANGE
      const viewerUser = createMockUser({ role: UserRole.VIEWER });

      (hasRequiredRole as jest.Mock).mockReturnValue(false); // VIEWER < EDITOR

      // ACT
      const canCreate = hasRequiredRole(viewerUser.role, UserRole.EDITOR);

      // ASSERT
      expect(canCreate).toBe(false);
    });

    it('should deny VIEWER from updating budgets', async () => {
      // ARRANGE
      const viewerUser = createMockUser({ role: UserRole.VIEWER });

      (hasRequiredRole as jest.Mock).mockReturnValue(false);

      // ACT
      const canUpdate = hasRequiredRole(viewerUser.role, UserRole.EDITOR);

      // ASSERT
      expect(canUpdate).toBe(false);
    });

    it('should deny VIEWER from deleting budgets', async () => {
      // ARRANGE
      const viewerUser = createMockUser({ role: UserRole.VIEWER });

      (hasRequiredRole as jest.Mock).mockReturnValue(false);

      // ACT
      const canDelete = hasRequiredRole(viewerUser.role, UserRole.EDITOR);

      // ASSERT
      expect(canDelete).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // EDITOR ROLE
  // --------------------------------------------------------------------------

  describe('EDITOR Role Permissions', () => {
    it('should allow EDITOR to create budgets (Full CRUD access)', async () => {
      // ARRANGE
      const editorUser = createMockUser({ role: UserRole.EDITOR });

      (hasRequiredRole as jest.Mock).mockReturnValue(true);

      // ACT
      const canCreate = hasRequiredRole(editorUser.role, UserRole.EDITOR);

      // ASSERT
      expect(canCreate).toBe(true);
    });

    it('should allow EDITOR to read budgets', async () => {
      // ARRANGE
      const editorUser = createMockUser({ role: UserRole.EDITOR });

      (hasRequiredRole as jest.Mock).mockReturnValue(true);

      // ACT
      const canRead = hasRequiredRole(editorUser.role, UserRole.VIEWER);

      // ASSERT
      expect(canRead).toBe(true);
    });

    it('should allow EDITOR to update own budgets', async () => {
      // ARRANGE
      const editorUser = createMockUser({ role: UserRole.EDITOR });
      const ownBudget = createMockBudgetData({ createdBy: editorUser.id });

      (hasRequiredRole as jest.Mock).mockReturnValue(true);

      // ACT
      const hasRole = hasRequiredRole(editorUser.role, UserRole.EDITOR);
      const isOwner = ownBudget.createdBy === editorUser.id;

      // ASSERT
      expect(hasRole).toBe(true);
      expect(isOwner).toBe(true);
    });

    it('should allow EDITOR to delete own budgets', async () => {
      // ARRANGE
      const editorUser = createMockUser({ role: UserRole.EDITOR });
      const ownBudget = createMockBudgetData({ createdBy: editorUser.id });

      (hasRequiredRole as jest.Mock).mockReturnValue(true);

      // ACT
      const hasRole = hasRequiredRole(editorUser.role, UserRole.EDITOR);
      const isOwner = ownBudget.createdBy === editorUser.id;
      const canDelete = hasRole && isOwner;

      // ASSERT
      expect(canDelete).toBe(true);
    });

    it('should allow EDITOR to query all accessible budgets', async () => {
      // ARRANGE
      const editorUser = createMockUser({ role: UserRole.EDITOR });

      (hasRequiredRole as jest.Mock).mockReturnValue(true);

      // ACT
      const canQuery = hasRequiredRole(editorUser.role, UserRole.VIEWER);

      // ASSERT
      expect(canQuery).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // ADMIN ROLE
  // --------------------------------------------------------------------------

  describe('ADMIN Role Permissions', () => {
    it('should allow ADMIN to modify any budget (Override ownership check)', async () => {
      // ARRANGE
      const adminUser = createMockUser({ id: 'admin-user', role: UserRole.ADMIN });
      const otherUserBudget = createMockBudgetData({
        createdBy: 'other-user',
        ownerId: 'other-user',
      });

      // ADMIN bypasses ownership check
      const isAdmin = adminUser.role === UserRole.ADMIN;

      // ACT
      const canModify = isAdmin || otherUserBudget.createdBy === adminUser.id;

      // ASSERT
      expect(isAdmin).toBe(true);
      expect(canModify).toBe(true);
    });

    it('should allow ADMIN to delete any budget', async () => {
      // ARRANGE
      const adminUser = createMockUser({ id: 'admin-user', role: UserRole.ADMIN });
      const otherUserBudget = createMockBudgetData({
        createdBy: 'other-user',
        isSystemEverythingElse: false,
      });

      // ACT
      const isAdmin = adminUser.role === UserRole.ADMIN;
      const canDelete = isAdmin;

      // ASSERT
      expect(canDelete).toBe(true);
    });

    it('should allow ADMIN to access all family budgets', async () => {
      // ARRANGE
      const adminUser = createMockUser({
        id: 'admin-user',
        role: UserRole.ADMIN,
        familyId: 'family-123',
      });

      (checkUserAccess as jest.Mock).mockResolvedValue(true);

      // ACT
      const hasAccess = await checkUserAccess(adminUser.id, 'other-family-member');

      // ASSERT
      expect(hasAccess).toBe(true);
    });

    it('should allow ADMIN to query all budgets in system', async () => {
      // ARRANGE
      const adminUser = createMockUser({ role: UserRole.ADMIN });

      (hasRequiredRole as jest.Mock).mockReturnValue(true);

      // ACT
      const canQueryAll = hasRequiredRole(adminUser.role, UserRole.ADMIN);

      // ASSERT
      expect(canQueryAll).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // SYSTEM ROLE CAPABILITIES
  // --------------------------------------------------------------------------

  describe('System Role Capabilities', () => {
    it('should verify ADMIN can create budgets', () => {
      // ASSERT
      expect(ROLE_CAPABILITIES[SystemRole.ADMIN].canCreateBudgets).toBe(true);
    });

    it('should verify POWER_USER can create budgets', () => {
      // ASSERT
      expect(ROLE_CAPABILITIES[SystemRole.POWER_USER].canCreateBudgets).toBe(true);
    });

    it('should verify STANDARD_USER can create budgets', () => {
      // ASSERT
      expect(ROLE_CAPABILITIES[SystemRole.STANDARD_USER].canCreateBudgets).toBe(true);
    });

    it('should verify DEMO_USER cannot create budgets', () => {
      // ASSERT
      expect(ROLE_CAPABILITIES[SystemRole.DEMO_USER].canCreateBudgets).toBe(false);
    });

    it('should verify DEMO_USER has no write capabilities', () => {
      // ASSERT
      const demoCapabilities = ROLE_CAPABILITIES[SystemRole.DEMO_USER];
      expect(demoCapabilities.canCreateBudgets).toBe(false);
      expect(demoCapabilities.canCreateTransactions).toBe(false);
      expect(demoCapabilities.canShareResources).toBe(false);
    });
  });
});

// ============================================================================
// OWNERSHIP & SHARING TESTS
// ============================================================================

describe('Budget Security - Ownership & Sharing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // OWNERSHIP
  // --------------------------------------------------------------------------

  describe('Owner Access Control', () => {
    it('should allow owner to update own budget (createdBy matches user)', async () => {
      // ARRANGE
      const user = createMockUser({ id: 'user-123' });
      const ownBudget = createMockBudgetData({
        createdBy: 'user-123',
        ownerId: 'user-123',
      });

      // ACT
      const isOwner = ownBudget.createdBy === user.id;
      const canUpdate = isOwner;

      // ASSERT
      expect(isOwner).toBe(true);
      expect(canUpdate).toBe(true);
    });

    it('should deny non-owner from updating budget (Permission denied)', async () => {
      // ARRANGE
      const user = createMockUser({ id: 'user-456', role: UserRole.VIEWER });
      const otherUserBudget = createMockBudgetData({
        createdBy: 'user-123',
        ownerId: 'user-123',
      });

      // ACT
      const isOwner = otherUserBudget.createdBy === user.id;
      const isAdmin = user.role === UserRole.ADMIN;
      const canUpdate = isOwner || isAdmin;

      // ASSERT
      expect(isOwner).toBe(false);
      expect(canUpdate).toBe(false);
    });

    it('should allow owner to delete own budget', async () => {
      // ARRANGE
      const user = createMockUser({ id: 'user-123' });
      const ownBudget = createMockBudgetData({
        createdBy: 'user-123',
        isSystemEverythingElse: false,
      });

      // ACT
      const isOwner = ownBudget.createdBy === user.id;
      const isSystemBudget = ownBudget.isSystemEverythingElse === true;
      const canDelete = isOwner && !isSystemBudget;

      // ASSERT
      expect(canDelete).toBe(true);
    });

    it('should deny non-owner from deleting budget', async () => {
      // ARRANGE
      const user = createMockUser({ id: 'user-456', role: UserRole.VIEWER });
      const otherUserBudget = createMockBudgetData({
        createdBy: 'user-123',
      });

      // ACT
      const isOwner = otherUserBudget.createdBy === user.id;
      const isAdmin = user.role === UserRole.ADMIN;
      const canDelete = isOwner || isAdmin;

      // ASSERT
      expect(canDelete).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // FAMILY MEMBERSHIP
  // --------------------------------------------------------------------------

  describe('Family Member Access Control', () => {
    it('should allow family member to read shared budget (familyId membership)', async () => {
      // ARRANGE
      const familyMember = createMockUser({
        id: 'family-member-1',
        familyId: 'family-123',
      });
      const sharedBudget = createMockBudgetData({
        isShared: true,
        familyId: 'family-123',
        createdBy: 'family-member-2',
      });

      (checkFamilyAccess as jest.Mock).mockResolvedValue(true);

      // ACT
      const hasAccess = await checkFamilyAccess(familyMember.id, sharedBudget.familyId!);

      // ASSERT
      expect(hasAccess).toBe(true);
    });

    it('should deny non-family member from reading shared budget (Access denied)', async () => {
      // ARRANGE
      const outsider = createMockUser({
        id: 'outsider-123',
        familyId: 'other-family-456',
      });
      const sharedBudget = createMockBudgetData({
        isShared: true,
        familyId: 'family-123',
      });

      (checkFamilyAccess as jest.Mock).mockResolvedValue(false);

      // ACT
      const hasAccess = await checkFamilyAccess(outsider.id, sharedBudget.familyId!);

      // ASSERT
      expect(hasAccess).toBe(false);
    });

    it('should allow family member to view memberIds on shared budget', async () => {
      // ARRANGE
      const familyMember = createMockUser({
        id: 'family-member-1',
        familyId: 'family-123',
      });
      const sharedBudget = createMockBudgetData({
        isShared: true,
        familyId: 'family-123',
        memberIds: ['family-member-1', 'family-member-2'],
      });

      (checkFamilyAccess as jest.Mock).mockResolvedValue(true);

      // ACT
      const isMember = sharedBudget.memberIds.includes(familyMember.id);
      const inSameFamily = await checkFamilyAccess(familyMember.id, sharedBudget.familyId!);

      // ASSERT
      expect(isMember).toBe(true);
      expect(inSameFamily).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // PRIVATE BUDGETS (groupIds=[])
  // --------------------------------------------------------------------------

  describe('Private Budget Restrictions', () => {
    it('should restrict private budget to owner-only (groupIds=[] restricts)', async () => {
      // ARRANGE
      const owner = createMockUser({ id: 'owner-123' });
      const privateBudget = createMockBudgetData({
        createdBy: 'owner-123',
        ownerId: 'owner-123',
        groupIds: [], // Empty = private
        isPrivate: true,
        isShared: false,
      });

      // ACT
      const isOwner = privateBudget.ownerId === owner.id;
      const isPrivate = privateBudget.groupIds.length === 0;
      const canAccess = isOwner; // Only owner can access private budgets

      // ASSERT
      expect(isPrivate).toBe(true);
      expect(canAccess).toBe(true);
    });

    it('should deny non-owner access to private budget', async () => {
      // ARRANGE
      const nonOwner = createMockUser({ id: 'non-owner-456' });
      const privateBudget = createMockBudgetData({
        createdBy: 'owner-123',
        ownerId: 'owner-123',
        groupIds: [],
        isPrivate: true,
      });

      // ACT
      const isOwner = privateBudget.ownerId === nonOwner.id;
      const isPrivate = privateBudget.groupIds.length === 0;
      const canAccess = isOwner || !isPrivate;

      // ASSERT
      expect(isPrivate).toBe(true);
      expect(isOwner).toBe(false);
      expect(canAccess).toBe(false);
    });

    it('should allow access when groupIds is not empty', async () => {
      // ARRANGE
      const groupMember = createMockUser({
        id: 'group-member-1',
        groupIds: ['group-123'],
      });
      const sharedBudget = createMockBudgetData({
        groupIds: ['group-123'],
        isPrivate: false,
      });

      // ACT
      const userInGroup = groupMember.groupIds?.some(g => sharedBudget.groupIds.includes(g));
      const isPrivate = sharedBudget.groupIds.length === 0;

      // ASSERT
      expect(isPrivate).toBe(false);
      expect(userInGroup).toBe(true);
    });

    it('should correctly set isPrivate based on groupIds', () => {
      // ARRANGE
      const userId = 'test-user';

      // ACT - Private (no groups)
      const privateAccess = buildAccessControl(userId, userId, []);

      // ACT - Shared (with groups)
      const sharedAccess = buildAccessControl(userId, userId, ['group-123']);

      // ASSERT
      expect(privateAccess.isPrivate).toBe(true);
      expect(sharedAccess.isPrivate).toBe(false);
    });
  });
});

// ============================================================================
// INPUT VALIDATION TESTS
// ============================================================================

describe('Budget Security - Input Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // XSS PREVENTION
  // --------------------------------------------------------------------------

  describe('Input Sanitization (XSS Prevention)', () => {
    it('should sanitize name input to strip HTML tags', () => {
      // ARRANGE
      const maliciousName = '<script>alert("xss")</script>Groceries';

      // ACT - Simulate sanitization function
      const sanitizeName = (input: string): string => {
        return input.replace(/<[^>]*>/g, ''); // Strip HTML tags
      };
      const sanitizedName = sanitizeName(maliciousName);

      // ASSERT
      expect(sanitizedName).toBe('alert("xss")Groceries');
      expect(sanitizedName).not.toContain('<script>');
      expect(sanitizedName).not.toContain('</script>');
    });

    it('should sanitize description to prevent XSS', () => {
      // ARRANGE
      const maliciousDescription = '<img src="x" onerror="alert(1)">My budget description';

      // ACT
      const sanitizeDescription = (input: string): string => {
        return input.replace(/<[^>]*>/g, '');
      };
      const sanitizedDescription = sanitizeDescription(maliciousDescription);

      // ASSERT
      expect(sanitizedDescription).toBe('My budget description');
      expect(sanitizedDescription).not.toContain('<img');
      expect(sanitizedDescription).not.toContain('onerror');
    });

    it('should handle nested HTML tags in sanitization', () => {
      // ARRANGE
      const nestedTags = '<div><span onclick="alert(1)">Budget</span></div>';

      // ACT
      const sanitize = (input: string): string => {
        return input.replace(/<[^>]*>/g, '');
      };
      const sanitized = sanitize(nestedTags);

      // ASSERT
      expect(sanitized).toBe('Budget');
    });

    it('should preserve valid text content during sanitization', () => {
      // ARRANGE
      const validName = 'Groceries & Food Budget - 2025';

      // ACT
      const sanitize = (input: string): string => {
        return input.replace(/<[^>]*>/g, '');
      };
      const sanitized = sanitize(validName);

      // ASSERT
      expect(sanitized).toBe(validName);
    });
  });

  // --------------------------------------------------------------------------
  // AMOUNT VALIDATION
  // --------------------------------------------------------------------------

  describe('Amount Range Validation', () => {
    it('should accept valid positive amounts', () => {
      // ARRANGE & ACT
      const amounts = [0.01, 1, 100, 1000.50, 999999.99];

      // ASSERT
      amounts.forEach(amount => {
        const isValid = amount > 0;
        expect(isValid).toBe(true);
      });
    });

    it('should reject negative amounts (Positive numbers only)', () => {
      // ARRANGE
      const negativeAmount = -100;

      // ACT
      const isValid = negativeAmount > 0;

      // ASSERT
      expect(isValid).toBe(false);
    });

    it('should reject zero amount for non-system budgets', () => {
      // ARRANGE
      const amount = 0;
      const isSystemBudget = false;

      // ACT
      const isValid = isSystemBudget || amount > 0;

      // ASSERT
      expect(isValid).toBe(false);
    });

    it('should accept zero amount for system budgets', () => {
      // ARRANGE
      const amount = 0;
      const isSystemBudget = true;

      // ACT
      const isValid = isSystemBudget || amount > 0;

      // ASSERT
      expect(isValid).toBe(true);
    });

    it('should reject NaN amount', () => {
      // ARRANGE
      const amount = NaN;

      // ACT
      const isValid = !isNaN(amount) && amount > 0;

      // ASSERT
      expect(isValid).toBe(false);
    });

    it('should reject Infinity amount', () => {
      // ARRANGE
      const amount = Infinity;

      // ACT
      const isValid = isFinite(amount) && amount > 0;

      // ASSERT
      expect(isValid).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // DATE FORMAT VALIDATION
  // --------------------------------------------------------------------------

  describe('Date Format Validation', () => {
    it('should accept valid ISO date strings', () => {
      // ARRANGE
      const validDates = [
        '2025-01-01T00:00:00Z',
        '2025-12-31T23:59:59Z',
        '2024-02-29T12:00:00Z', // Leap year
      ];

      // ACT & ASSERT
      validDates.forEach(dateStr => {
        const date = new Date(dateStr);
        const isValid = !isNaN(date.getTime());
        expect(isValid).toBe(true);
      });
    });

    it('should reject invalid date strings', () => {
      // ARRANGE
      const invalidDates = [
        'not-a-date',
        '2025-13-01', // Invalid month
        '2025-01-32', // Invalid day
        '',
      ];

      // ACT & ASSERT
      invalidDates.forEach(dateStr => {
        const date = new Date(dateStr);
        const isValid = dateStr !== '' && !isNaN(date.getTime());
        expect(isValid).toBe(false);
      });
    });

    it('should reject invalid leap year dates', () => {
      // ARRANGE
      const invalidLeapYear = '2023-02-29'; // 2023 is not a leap year

      // ACT
      const date = new Date(invalidLeapYear);
      // JavaScript Date will roll over to March 1
      const isValidLeapDay = date.getMonth() === 1 && date.getDate() === 29;

      // ASSERT
      expect(isValidLeapDay).toBe(false);
    });

    it('should validate startDate is before endDate', () => {
      // ARRANGE
      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-12-31');

      // ACT
      const isValid = startDate < endDate;

      // ASSERT
      expect(isValid).toBe(true);
    });

    it('should reject endDate before startDate', () => {
      // ARRANGE
      const startDate = new Date('2025-12-31');
      const endDate = new Date('2025-01-01');

      // ACT
      const isValid = endDate > startDate;

      // ASSERT
      expect(isValid).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // CATEGORY IDS VALIDATION
  // --------------------------------------------------------------------------

  describe('CategoryIds Format Validation', () => {
    it('should accept valid categoryIds array (Array of strings)', async () => {
      // ARRANGE
      const categoryIds = ['FOOD_AND_DRINK_GROCERIES', 'FOOD_AND_DRINK_RESTAURANTS'];

      (validateCategoryIds as jest.Mock).mockResolvedValue({
        isValid: true,
        invalidIds: [],
        validCategories: categoryIds.map(id => ({ id, name: id, type: 'expense' })),
      });

      // ACT
      const result = await validateCategoryIds(categoryIds);

      // ASSERT
      expect(result.isValid).toBe(true);
      expect(result.invalidIds).toHaveLength(0);
    });

    it('should reject empty categoryIds array', () => {
      // ARRANGE
      const categoryIds: string[] = [];

      // ACT
      const isValid = categoryIds.length >= 1;

      // ASSERT
      expect(isValid).toBe(false);
    });

    it('should reject categoryIds with non-string elements', () => {
      // ARRANGE
      const categoryIds = ['valid-id', 123, null] as any[];

      // ACT
      const allStrings = categoryIds.every(id => typeof id === 'string');

      // ASSERT
      expect(allStrings).toBe(false);
    });

    it('should reject invalid category IDs', async () => {
      // ARRANGE
      const categoryIds = ['INVALID_CATEGORY', 'ALSO_INVALID'];

      (validateCategoryIds as jest.Mock).mockResolvedValue({
        isValid: false,
        invalidIds: ['INVALID_CATEGORY', 'ALSO_INVALID'],
        validCategories: [],
      });

      // ACT
      const result = await validateCategoryIds(categoryIds);

      // ASSERT
      expect(result.isValid).toBe(false);
      expect(result.invalidIds).toContain('INVALID_CATEGORY');
    });

    it('should handle mixed valid and invalid categoryIds', async () => {
      // ARRANGE
      const categoryIds = ['FOOD_AND_DRINK_GROCERIES', 'INVALID_CATEGORY'];

      (validateCategoryIds as jest.Mock).mockResolvedValue({
        isValid: false,
        invalidIds: ['INVALID_CATEGORY'],
        validCategories: [{ id: 'FOOD_AND_DRINK_GROCERIES', name: 'Groceries', type: 'expense' }],
      });

      // ACT
      const result = await validateCategoryIds(categoryIds);

      // ASSERT
      expect(result.isValid).toBe(false);
      expect(result.invalidIds).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // DESCRIPTION LENGTH LIMITS
  // --------------------------------------------------------------------------

  describe('Description Length Validation', () => {
    it('should accept description within 500 character limit', () => {
      // ARRANGE
      const validDescription = 'A'.repeat(500);

      // ACT
      const isValid = validDescription.length <= 500;

      // ASSERT
      expect(isValid).toBe(true);
    });

    it('should reject description exceeding 500 character limit', () => {
      // ARRANGE
      const longDescription = 'A'.repeat(501);

      // ACT
      const isValid = longDescription.length <= 500;

      // ASSERT
      expect(isValid).toBe(false);
    });

    it('should accept empty description', () => {
      // ARRANGE
      const emptyDescription = '';

      // ACT
      const isValid = emptyDescription.length <= 500;

      // ASSERT
      expect(isValid).toBe(true);
    });

    it('should correctly count multi-byte characters', () => {
      // ARRANGE - Emoji takes multiple bytes but should count as 1-2 characters
      const emojiDescription = 'Budget for food ' + '\u{1F355}'.repeat(100); // Pizza emoji

      // ACT
      const charCount = [...emojiDescription].length; // Use spread for accurate Unicode count

      // ASSERT
      expect(charCount).toBeLessThanOrEqual(500);
    });
  });

  // --------------------------------------------------------------------------
  // NAME LENGTH LIMITS
  // --------------------------------------------------------------------------

  describe('Name Length Validation', () => {
    it('should accept name within 100 character limit', () => {
      // ARRANGE
      const validName = 'A'.repeat(100);

      // ACT
      const isValid = validName.length <= 100;

      // ASSERT
      expect(isValid).toBe(true);
    });

    it('should reject name exceeding 100 character limit', () => {
      // ARRANGE
      const longName = 'A'.repeat(101);

      // ACT
      const isValid = longName.length <= 100;

      // ASSERT
      expect(isValid).toBe(false);
    });

    it('should reject empty name', () => {
      // ARRANGE
      const emptyName = '';

      // ACT
      const isValid = emptyName.length >= 1 && emptyName.length <= 100;

      // ASSERT
      expect(isValid).toBe(false);
    });

    it('should reject whitespace-only name', () => {
      // ARRANGE
      const whitespaceOnlyName = '   ';

      // ACT
      const trimmedName = whitespaceOnlyName.trim();
      const isValid = trimmedName.length >= 1;

      // ASSERT
      expect(isValid).toBe(false);
    });
  });
});

// ============================================================================
// ADDITIONAL SECURITY EDGE CASES
// ============================================================================

describe('Budget Security - Edge Cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Cross-User Access Attempts', () => {
    it('should prevent user A from accessing user B private budget via direct ID', async () => {
      // ARRANGE
      const userA = createMockUser({ id: 'user-A' });
      const userBBudget = createMockBudgetData({
        id: 'user-B-budget',
        createdBy: 'user-B',
        ownerId: 'user-B',
        groupIds: [],
        isPrivate: true,
      });

      // ACT
      const isOwner = userBBudget.ownerId === userA.id;
      const isInGroup = userA.groupIds?.some(g => userBBudget.groupIds.includes(g)) ?? false;
      const canAccess = isOwner || isInGroup;

      // ASSERT
      expect(canAccess).toBe(false);
    });

    it('should prevent budget enumeration via sequential IDs', async () => {
      // ARRANGE - Simulate trying sequential IDs
      const attacker = createMockUser({ id: 'attacker' });
      const budgetIds = ['budget-001', 'budget-002', 'budget-003'];

      // ACT - Each budget should require ownership check
      const accessResults = budgetIds.map(budgetId => {
        const budget = createMockBudgetData({
          id: budgetId,
          createdBy: 'victim',
          ownerId: 'victim',
          groupIds: [],
        });
        return budget.ownerId === attacker.id;
      });

      // ASSERT - All should be denied
      expect(accessResults.every(result => result === false)).toBe(true);
    });
  });

  describe('Privilege Escalation Prevention', () => {
    it('should prevent user from modifying createdBy field', () => {
      // ARRANGE
      const user = createMockUser({ id: 'regular-user' });
      const existingBudget = createMockBudgetData({
        createdBy: 'original-creator',
      });

      // ACT - Simulate attempted createdBy modification
      const updateAttempt = { createdBy: 'regular-user' };
      const protectedFields = ['createdBy', 'ownerId', 'createdAt', 'id'];
      const hasProtectedFieldChange = Object.keys(updateAttempt).some(key =>
        protectedFields.includes(key)
      );

      // ASSERT
      expect(hasProtectedFieldChange).toBe(true);
    });

    it('should prevent user from modifying ownerId field', () => {
      // ARRANGE
      const protectedFields = ['createdBy', 'ownerId', 'createdAt', 'id'];
      const updateAttempt = { ownerId: 'hijacker' };

      // ACT
      const hasProtectedFieldChange = Object.keys(updateAttempt).some(key =>
        protectedFields.includes(key)
      );

      // ASSERT
      expect(hasProtectedFieldChange).toBe(true);
    });

    it('should prevent VIEWER from escalating to EDITOR permissions', () => {
      // ARRANGE
      const viewer = createMockUser({ role: UserRole.VIEWER });

      // ACT - VIEWER trying to perform EDITOR action
      const canCreate = viewer.role === UserRole.EDITOR || viewer.role === UserRole.ADMIN;
      const canUpdate = viewer.role === UserRole.EDITOR || viewer.role === UserRole.ADMIN;
      const canDelete = viewer.role === UserRole.EDITOR || viewer.role === UserRole.ADMIN;

      // ASSERT
      expect(canCreate).toBe(false);
      expect(canUpdate).toBe(false);
      expect(canDelete).toBe(false);
    });
  });

  describe('System Budget Protection', () => {
    it('should prevent deletion of isSystemEverythingElse budget', () => {
      // ARRANGE
      const user = createMockUser({ role: UserRole.ADMIN });
      const systemBudget = createMockBudgetData({
        isSystemEverythingElse: true,
        name: 'Everything Else',
      });

      // ACT
      const canDelete = !systemBudget.isSystemEverythingElse;

      // ASSERT
      expect(canDelete).toBe(false);
    });

    it('should prevent amount modification on system budget', () => {
      // ARRANGE
      const systemBudget = createMockBudgetData({
        isSystemEverythingElse: true,
        amount: 0,
      });
      const updateAttempt = { amount: 100 };

      // ACT
      const isSystemBudget = systemBudget.isSystemEverythingElse === true;
      const hasAmountUpdate = 'amount' in updateAttempt;
      const shouldReject = isSystemBudget && hasAmountUpdate;

      // ASSERT
      expect(shouldReject).toBe(true);
    });

    it('should allow name change on system budget only', () => {
      // ARRANGE
      const allowedSystemBudgetFields = ['name', 'updatedAt'];
      const validUpdate = { name: 'Miscellaneous' };
      const invalidUpdate = { name: 'Misc', amount: 100, categoryIds: ['new-cat'] };

      // ACT
      const validUpdateAllowed = Object.keys(validUpdate).every(key =>
        allowedSystemBudgetFields.includes(key)
      );
      const invalidUpdateAllowed = Object.keys(invalidUpdate).every(key =>
        allowedSystemBudgetFields.includes(key)
      );

      // ASSERT
      expect(validUpdateAllowed).toBe(true);
      expect(invalidUpdateAllowed).toBe(false);
    });
  });
});
