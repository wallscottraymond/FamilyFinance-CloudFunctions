/**
 * @file auth.test.ts
 * @description Comprehensive tests for authentication utilities
 *
 * FUNCTIONALITY TESTED:
 * - Token verification
 * - Role hierarchy checking
 * - User retrieval with role information
 * - Family access checking
 * - User access permissions
 * - Custom claims management
 * - Response formatting
 * - Auth middleware
 *
 * EXPECTED OUTCOMES:
 * - Proper token verification with Firebase Admin
 * - Role hierarchy correctly enforced (VIEWER < EDITOR < ADMIN)
 * - Family and user access properly validated
 * - Error responses properly formatted
 *
 * DEPENDENCIES:
 * - Mocked firebase-admin
 * - Mocked firestore utilities
 *
 * RELATED FILES:
 * - src/utils/auth.ts
 * - src/types/index.ts
 */

import { UserRole } from '../../types';

// Mock firebase-admin before imports
jest.mock('firebase-admin', () => {
  const mockAuth = {
    verifyIdToken: jest.fn(),
    setCustomUserClaims: jest.fn(),
    revokeRefreshTokens: jest.fn(),
    deleteUser: jest.fn(),
  };

  return {
    initializeApp: jest.fn(),
    auth: jest.fn(() => mockAuth),
    firestore: jest.fn(() => ({
      settings: jest.fn(),
    })),
  };
});

// Mock firestore utilities
jest.mock('../firestore', () => ({
  getDocument: jest.fn(),
}));

import * as admin from 'firebase-admin';
import { getDocument } from '../firestore';
import {
  verifyAuthToken,
  getUserWithRole,
  hasRequiredRole,
  checkFamilyAccess,
  checkUserAccess,
  createErrorResponse,
  createSuccessResponse,
  authMiddleware,
  generateInviteCode,
  setUserClaims,
  revokeUserTokens,
  deleteUserAccount,
  validateCorsOrigin,
  authenticateRequest,
} from '../auth';

describe('Auth Utilities', () => {
  const mockAuth = admin.auth() as jest.Mocked<any>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('verifyAuthToken', () => {
    it('should return decoded token for valid token', async () => {
      // ARRANGE
      const mockDecodedToken = {
        uid: 'user_123',
        email: 'test@example.com',
        role: UserRole.EDITOR,
        familyId: 'family_456',
        iat: 1234567890,
        exp: 1234567890 + 3600,
      };
      mockAuth.verifyIdToken.mockResolvedValue(mockDecodedToken);

      // ACT
      const result = await verifyAuthToken('valid_token');

      // ASSERT
      expect(result).toEqual(mockDecodedToken);
      expect(mockAuth.verifyIdToken).toHaveBeenCalledWith('valid_token');
    });

    it('should throw error for invalid token', async () => {
      // ARRANGE
      mockAuth.verifyIdToken.mockRejectedValue(new Error('Token expired'));

      // ACT & ASSERT
      await expect(verifyAuthToken('invalid_token')).rejects.toThrow(
        'Invalid authentication token: Token expired'
      );
    });

    it('should throw error for malformed token', async () => {
      // ARRANGE
      mockAuth.verifyIdToken.mockRejectedValue(new Error('Malformed token'));

      // ACT & ASSERT
      await expect(verifyAuthToken('malformed')).rejects.toThrow(
        'Invalid authentication token: Malformed token'
      );
    });
  });

  describe('getUserWithRole', () => {
    it('should return user document with role', async () => {
      // ARRANGE
      const mockUser = {
        id: 'user_123',
        email: 'test@example.com',
        displayName: 'Test User',
        role: UserRole.EDITOR,
        familyId: 'family_456',
        isActive: true,
      };
      (getDocument as jest.Mock).mockResolvedValue(mockUser);

      // ACT
      const result = await getUserWithRole('user_123');

      // ASSERT
      expect(result).toEqual(mockUser);
      expect(getDocument).toHaveBeenCalledWith('users', 'user_123');
    });

    it('should return null when user not found', async () => {
      // ARRANGE
      (getDocument as jest.Mock).mockResolvedValue(null);

      // ACT
      const result = await getUserWithRole('nonexistent');

      // ASSERT
      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      // ARRANGE
      (getDocument as jest.Mock).mockRejectedValue(new Error('DB error'));

      // ACT
      const result = await getUserWithRole('user_123');

      // ASSERT
      expect(result).toBeNull();
    });
  });

  describe('hasRequiredRole', () => {
    describe('role hierarchy enforcement', () => {
      it('should allow ADMIN to access ADMIN resources', () => {
        expect(hasRequiredRole(UserRole.ADMIN, UserRole.ADMIN)).toBe(true);
      });

      it('should allow ADMIN to access EDITOR resources', () => {
        expect(hasRequiredRole(UserRole.ADMIN, UserRole.EDITOR)).toBe(true);
      });

      it('should allow ADMIN to access VIEWER resources', () => {
        expect(hasRequiredRole(UserRole.ADMIN, UserRole.VIEWER)).toBe(true);
      });

      it('should allow EDITOR to access EDITOR resources', () => {
        expect(hasRequiredRole(UserRole.EDITOR, UserRole.EDITOR)).toBe(true);
      });

      it('should allow EDITOR to access VIEWER resources', () => {
        expect(hasRequiredRole(UserRole.EDITOR, UserRole.VIEWER)).toBe(true);
      });

      it('should NOT allow EDITOR to access ADMIN resources', () => {
        expect(hasRequiredRole(UserRole.EDITOR, UserRole.ADMIN)).toBe(false);
      });

      it('should allow VIEWER to access VIEWER resources', () => {
        expect(hasRequiredRole(UserRole.VIEWER, UserRole.VIEWER)).toBe(true);
      });

      it('should NOT allow VIEWER to access EDITOR resources', () => {
        expect(hasRequiredRole(UserRole.VIEWER, UserRole.EDITOR)).toBe(false);
      });

      it('should NOT allow VIEWER to access ADMIN resources', () => {
        expect(hasRequiredRole(UserRole.VIEWER, UserRole.ADMIN)).toBe(false);
      });
    });
  });

  describe('checkFamilyAccess', () => {
    it('should return true when user belongs to family', async () => {
      // ARRANGE
      const mockUser = {
        id: 'user_123',
        familyId: 'family_456',
        role: UserRole.EDITOR,
      };
      (getDocument as jest.Mock).mockResolvedValue(mockUser);

      // ACT
      const result = await checkFamilyAccess('user_123', 'family_456');

      // ASSERT
      expect(result).toBe(true);
    });

    it('should return false when user belongs to different family', async () => {
      // ARRANGE
      const mockUser = {
        id: 'user_123',
        familyId: 'family_other',
        role: UserRole.EDITOR,
      };
      (getDocument as jest.Mock).mockResolvedValue(mockUser);

      // ACT
      const result = await checkFamilyAccess('user_123', 'family_456');

      // ASSERT
      expect(result).toBe(false);
    });

    it('should return false when user has no family', async () => {
      // ARRANGE
      const mockUser = {
        id: 'user_123',
        familyId: null,
        role: UserRole.EDITOR,
      };
      (getDocument as jest.Mock).mockResolvedValue(mockUser);

      // ACT
      const result = await checkFamilyAccess('user_123', 'family_456');

      // ASSERT
      expect(result).toBe(false);
    });

    it('should return false when user not found', async () => {
      // ARRANGE
      (getDocument as jest.Mock).mockResolvedValue(null);

      // ACT
      const result = await checkFamilyAccess('nonexistent', 'family_456');

      // ASSERT
      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      // ARRANGE
      (getDocument as jest.Mock).mockRejectedValue(new Error('DB error'));

      // ACT
      const result = await checkFamilyAccess('user_123', 'family_456');

      // ASSERT
      expect(result).toBe(false);
    });
  });

  describe('checkUserAccess', () => {
    it('should allow user to access own data', async () => {
      // ACT
      const result = await checkUserAccess('user_123', 'user_123');

      // ASSERT
      expect(result).toBe(true);
      expect(getDocument).not.toHaveBeenCalled();
    });

    it('should allow ADMIN to access family member data', async () => {
      // ARRANGE
      const adminUser = {
        id: 'admin_user',
        familyId: 'family_456',
        role: UserRole.ADMIN,
      };
      const targetUser = {
        id: 'target_user',
        familyId: 'family_456',
        role: UserRole.VIEWER,
      };
      (getDocument as jest.Mock)
        .mockResolvedValueOnce(adminUser)
        .mockResolvedValueOnce(targetUser);

      // ACT
      const result = await checkUserAccess('admin_user', 'target_user');

      // ASSERT
      expect(result).toBe(true);
    });

    it('should NOT allow EDITOR to access other family member data', async () => {
      // ARRANGE
      const editorUser = {
        id: 'editor_user',
        familyId: 'family_456',
        role: UserRole.EDITOR,
      };
      const targetUser = {
        id: 'target_user',
        familyId: 'family_456',
        role: UserRole.VIEWER,
      };
      (getDocument as jest.Mock)
        .mockResolvedValueOnce(editorUser)
        .mockResolvedValueOnce(targetUser);

      // ACT
      const result = await checkUserAccess('editor_user', 'target_user');

      // ASSERT
      expect(result).toBe(false);
    });

    it('should NOT allow cross-family access even for ADMIN', async () => {
      // ARRANGE
      const adminUser = {
        id: 'admin_user',
        familyId: 'family_A',
        role: UserRole.ADMIN,
      };
      const targetUser = {
        id: 'target_user',
        familyId: 'family_B',
        role: UserRole.VIEWER,
      };
      (getDocument as jest.Mock)
        .mockResolvedValueOnce(adminUser)
        .mockResolvedValueOnce(targetUser);

      // ACT
      const result = await checkUserAccess('admin_user', 'target_user');

      // ASSERT
      expect(result).toBe(false);
    });

    it('should return false when requesting user not found', async () => {
      // ARRANGE
      (getDocument as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'target_user' });

      // ACT
      const result = await checkUserAccess('nonexistent', 'target_user');

      // ASSERT
      expect(result).toBe(false);
    });

    it('should return false when target user not found', async () => {
      // ARRANGE
      (getDocument as jest.Mock)
        .mockResolvedValueOnce({ id: 'admin_user', role: UserRole.ADMIN })
        .mockResolvedValueOnce(null);

      // ACT
      const result = await checkUserAccess('admin_user', 'nonexistent');

      // ASSERT
      expect(result).toBe(false);
    });
  });

  describe('createErrorResponse', () => {
    it('should create error response with code and message', () => {
      // ACT
      const result = createErrorResponse('invalid-input', 'Name is required');

      // ASSERT
      expect(result).toEqual({
        success: false,
        error: {
          code: 'invalid-input',
          message: 'Name is required',
        },
        timestamp: expect.any(String),
      });
    });

    it('should include details when provided', () => {
      // ACT
      const result = createErrorResponse('validation-error', 'Invalid data', {
        field: 'email',
        reason: 'Invalid format',
      });

      // ASSERT
      expect(result.error).toEqual({
        code: 'validation-error',
        message: 'Invalid data',
        details: {
          field: 'email',
          reason: 'Invalid format',
        },
      });
    });

    it('should have valid ISO timestamp', () => {
      // ACT
      const result = createErrorResponse('error', 'test');

      // ASSERT
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });
  });

  describe('createSuccessResponse', () => {
    it('should create success response without data', () => {
      // ACT
      const result = createSuccessResponse();

      // ASSERT
      expect(result).toEqual({
        success: true,
        timestamp: expect.any(String),
      });
    });

    it('should create success response with data', () => {
      // ACT
      const result = createSuccessResponse({ userId: 'user_123', name: 'Test' });

      // ASSERT
      expect(result).toEqual({
        success: true,
        data: { userId: 'user_123', name: 'Test' },
        timestamp: expect.any(String),
      });
    });

    it('should include undefined data when explicitly passed', () => {
      // ACT
      const result = createSuccessResponse(undefined);

      // ASSERT
      expect(result.success).toBe(true);
      expect(result).not.toHaveProperty('data');
    });
  });

  describe('generateInviteCode', () => {
    it('should generate code of default length (8)', () => {
      // ACT
      const code = generateInviteCode();

      // ASSERT
      expect(code).toHaveLength(8);
    });

    it('should generate code of specified length', () => {
      // ACT
      const code = generateInviteCode(12);

      // ASSERT
      expect(code).toHaveLength(12);
    });

    it('should only contain uppercase letters and numbers', () => {
      // ACT
      const code = generateInviteCode(100);

      // ASSERT
      expect(code).toMatch(/^[A-Z0-9]+$/);
    });

    it('should generate unique codes', () => {
      // ACT
      const codes = new Set();
      for (let i = 0; i < 100; i++) {
        codes.add(generateInviteCode());
      }

      // ASSERT - High probability of uniqueness
      expect(codes.size).toBeGreaterThan(95);
    });
  });

  describe('setUserClaims', () => {
    it('should set custom claims for user', async () => {
      // ARRANGE
      mockAuth.setCustomUserClaims.mockResolvedValue(undefined);

      // ACT
      await setUserClaims('user_123', { role: UserRole.ADMIN, familyId: 'family_456' });

      // ASSERT
      expect(mockAuth.setCustomUserClaims).toHaveBeenCalledWith('user_123', {
        role: UserRole.ADMIN,
        familyId: 'family_456',
      });
    });

    it('should throw error on failure', async () => {
      // ARRANGE
      mockAuth.setCustomUserClaims.mockRejectedValue(new Error('Auth service error'));

      // ACT & ASSERT
      await expect(
        setUserClaims('user_123', { role: UserRole.ADMIN })
      ).rejects.toThrow('Auth service error');
    });
  });

  describe('revokeUserTokens', () => {
    it('should revoke refresh tokens for user', async () => {
      // ARRANGE
      mockAuth.revokeRefreshTokens.mockResolvedValue(undefined);

      // ACT
      await revokeUserTokens('user_123');

      // ASSERT
      expect(mockAuth.revokeRefreshTokens).toHaveBeenCalledWith('user_123');
    });

    it('should throw error on failure', async () => {
      // ARRANGE
      mockAuth.revokeRefreshTokens.mockRejectedValue(new Error('Revocation failed'));

      // ACT & ASSERT
      await expect(revokeUserTokens('user_123')).rejects.toThrow('Revocation failed');
    });
  });

  describe('deleteUserAccount', () => {
    it('should delete user from Firebase Auth', async () => {
      // ARRANGE
      mockAuth.deleteUser.mockResolvedValue(undefined);

      // ACT
      await deleteUserAccount('user_123');

      // ASSERT
      expect(mockAuth.deleteUser).toHaveBeenCalledWith('user_123');
    });

    it('should throw error on failure', async () => {
      // ARRANGE
      mockAuth.deleteUser.mockRejectedValue(new Error('User not found'));

      // ACT & ASSERT
      await expect(deleteUserAccount('user_123')).rejects.toThrow('User not found');
    });
  });

  describe('validateCorsOrigin', () => {
    it('should allow localhost:3000', () => {
      expect(validateCorsOrigin('http://localhost:3000')).toBe(true);
    });

    it('should allow localhost:8081 (React Native)', () => {
      expect(validateCorsOrigin('http://localhost:8081')).toBe(true);
    });

    it('should allow production domain', () => {
      expect(validateCorsOrigin('https://family-finance-app.web.app')).toBe(true);
    });

    it('should allow firebaseapp.com domain', () => {
      expect(validateCorsOrigin('https://family-finance-app.firebaseapp.com')).toBe(true);
    });

    it('should allow any localhost port', () => {
      expect(validateCorsOrigin('http://localhost:5173')).toBe(true);
      expect(validateCorsOrigin('http://localhost:4200')).toBe(true);
    });

    it('should reject non-allowed origins', () => {
      expect(validateCorsOrigin('https://evil-site.com')).toBe(false);
      expect(validateCorsOrigin('https://example.com')).toBe(false);
    });
  });

  describe('authMiddleware', () => {
    const createMockRequest = (authHeader?: string) => ({
      get: jest.fn((header: string) => {
        if (header === 'Authorization') return authHeader;
        return undefined;
      }),
    });

    it('should return error when no Authorization header', async () => {
      // ARRANGE
      const mockRequest = createMockRequest();

      // ACT
      const result = await authMiddleware(mockRequest);

      // ASSERT
      expect(result.success).toBe(false);
      expect(result.error?.error?.code).toBe('auth/missing-token');
    });

    it('should return error when Authorization header missing Bearer prefix', async () => {
      // ARRANGE
      const mockRequest = createMockRequest('token_without_bearer');

      // ACT
      const result = await authMiddleware(mockRequest);

      // ASSERT
      expect(result.success).toBe(false);
      expect(result.error?.error?.code).toBe('auth/missing-token');
    });

    it('should return error when user document not found', async () => {
      // ARRANGE
      const mockRequest = createMockRequest('Bearer valid_token');
      mockAuth.verifyIdToken.mockResolvedValue({ uid: 'user_123' });
      (getDocument as jest.Mock).mockResolvedValue(null);

      // ACT
      const result = await authMiddleware(mockRequest);

      // ASSERT
      expect(result.success).toBe(false);
      expect(result.error?.error?.code).toBe('auth/user-not-found');
    });

    it('should return error when user is inactive', async () => {
      // ARRANGE
      const mockRequest = createMockRequest('Bearer valid_token');
      mockAuth.verifyIdToken.mockResolvedValue({ uid: 'user_123' });
      (getDocument as jest.Mock).mockResolvedValue({
        id: 'user_123',
        isActive: false,
        role: UserRole.EDITOR,
      });

      // ACT
      const result = await authMiddleware(mockRequest);

      // ASSERT
      expect(result.success).toBe(false);
      expect(result.error?.error?.code).toBe('auth/user-inactive');
    });

    it('should return error when user lacks required role', async () => {
      // ARRANGE
      const mockRequest = createMockRequest('Bearer valid_token');
      mockAuth.verifyIdToken.mockResolvedValue({ uid: 'user_123' });
      (getDocument as jest.Mock).mockResolvedValue({
        id: 'user_123',
        isActive: true,
        role: UserRole.VIEWER,
      });

      // ACT
      const result = await authMiddleware(mockRequest, UserRole.ADMIN);

      // ASSERT
      expect(result.success).toBe(false);
      expect(result.error?.error?.code).toBe('auth/insufficient-permissions');
    });

    it('should return success with user and token for valid request', async () => {
      // ARRANGE
      const mockRequest = createMockRequest('Bearer valid_token');
      const mockDecodedToken = {
        uid: 'user_123',
        email: 'test@example.com',
        role: UserRole.EDITOR,
      };
      const mockUser = {
        id: 'user_123',
        email: 'test@example.com',
        isActive: true,
        role: UserRole.EDITOR,
      };
      mockAuth.verifyIdToken.mockResolvedValue(mockDecodedToken);
      (getDocument as jest.Mock).mockResolvedValue(mockUser);

      // ACT
      const result = await authMiddleware(mockRequest, UserRole.VIEWER);

      // ASSERT
      expect(result.success).toBe(true);
      expect(result.user).toEqual(mockUser);
      expect(result.decodedToken).toEqual(mockDecodedToken);
    });

    it('should use VIEWER as default required role', async () => {
      // ARRANGE
      const mockRequest = createMockRequest('Bearer valid_token');
      mockAuth.verifyIdToken.mockResolvedValue({ uid: 'user_123' });
      (getDocument as jest.Mock).mockResolvedValue({
        id: 'user_123',
        isActive: true,
        role: UserRole.VIEWER,
      });

      // ACT
      const result = await authMiddleware(mockRequest);

      // ASSERT
      expect(result.success).toBe(true);
    });

    it('should handle token verification failure', async () => {
      // ARRANGE
      const mockRequest = createMockRequest('Bearer invalid_token');
      mockAuth.verifyIdToken.mockRejectedValue(new Error('Token verification failed'));

      // ACT
      const result = await authMiddleware(mockRequest);

      // ASSERT
      expect(result.success).toBe(false);
      expect(result.error?.error?.code).toBe('auth/verification-failed');
    });
  });

  describe('authenticateRequest', () => {
    const createMockHttpRequest = (authHeader?: string) => ({
      get: jest.fn((header: string) => {
        if (header === 'Authorization') return authHeader;
        return undefined;
      }),
    });

    const createMockCallableRequest = (uid?: string) => ({
      auth: uid ? { token: { uid } } : undefined,
    });

    it('should authenticate HTTP request with Bearer token', async () => {
      // ARRANGE
      const mockRequest = createMockHttpRequest('Bearer valid_token');
      const mockDecodedToken = { uid: 'user_123' };
      const mockUser = {
        id: 'user_123',
        isActive: true,
        role: UserRole.EDITOR,
      };
      mockAuth.verifyIdToken.mockResolvedValue(mockDecodedToken);
      (getDocument as jest.Mock).mockResolvedValue(mockUser);

      // ACT
      const result = await authenticateRequest(mockRequest);

      // ASSERT
      expect(result.user).toEqual(mockDecodedToken);
      expect(result.userData).toEqual(mockUser);
    });

    it('should authenticate callable request with auth token', async () => {
      // ARRANGE
      const mockRequest = createMockCallableRequest('user_123');
      const mockUser = {
        id: 'user_123',
        isActive: true,
        role: UserRole.EDITOR,
      };
      (getDocument as jest.Mock).mockResolvedValue(mockUser);

      // ACT
      const result = await authenticateRequest(mockRequest);

      // ASSERT
      expect(result.userData).toEqual(mockUser);
    });

    it('should throw when user document not found', async () => {
      // ARRANGE
      const mockRequest = createMockCallableRequest('user_123');
      (getDocument as jest.Mock).mockResolvedValue(null);

      // ACT & ASSERT
      await expect(authenticateRequest(mockRequest)).rejects.toThrow(
        'User document not found'
      );
    });

    it('should throw when user is inactive', async () => {
      // ARRANGE
      const mockRequest = createMockCallableRequest('user_123');
      (getDocument as jest.Mock).mockResolvedValue({
        id: 'user_123',
        isActive: false,
        role: UserRole.EDITOR,
      });

      // ACT & ASSERT
      await expect(authenticateRequest(mockRequest)).rejects.toThrow(
        'User account is inactive'
      );
    });

    it('should throw when user lacks required role', async () => {
      // ARRANGE
      const mockRequest = createMockCallableRequest('user_123');
      (getDocument as jest.Mock).mockResolvedValue({
        id: 'user_123',
        isActive: true,
        role: UserRole.VIEWER,
      });

      // ACT & ASSERT
      await expect(authenticateRequest(mockRequest, UserRole.ADMIN)).rejects.toThrow(
        'Required role: admin'
      );
    });

    it('should throw when no authorization provided', async () => {
      // ARRANGE
      const mockRequest = {};

      // ACT & ASSERT
      await expect(authenticateRequest(mockRequest)).rejects.toThrow(
        'Authorization header with Bearer token is required'
      );
    });
  });
});
