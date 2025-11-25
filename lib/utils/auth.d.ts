import * as admin from "firebase-admin";
import { User, UserRole, FunctionResponse } from "../types";
export { UserRole } from "../types";
/**
 * Middleware to verify Firebase Auth token
 */
export declare function verifyAuthToken(idToken: string): Promise<admin.auth.DecodedIdToken>;
/**
 * Get user document with role information
 */
export declare function getUserWithRole(uid: string): Promise<User | null>;
/**
 * Check if user has required role
 */
export declare function hasRequiredRole(userRole: UserRole, requiredRole: UserRole): boolean;
/**
 * Check if user belongs to the same family
 */
export declare function checkFamilyAccess(userId: string, targetFamilyId: string): Promise<boolean>;
/**
 * Check if user can access another user's data
 */
export declare function checkUserAccess(requestingUserId: string, targetUserId: string): Promise<boolean>;
/**
 * Create standardized error responses
 */
export declare function createErrorResponse(code: string, message: string, details?: Record<string, any>): FunctionResponse;
/**
 * Create standardized success responses
 */
export declare function createSuccessResponse<T>(data?: T): FunctionResponse<T>;
/**
 * Authentication middleware for HTTP functions
 */
export declare function authMiddleware(request: any, requiredRole?: UserRole): Promise<{
    success: boolean;
    user?: User;
    decodedToken?: admin.auth.DecodedIdToken;
    error?: FunctionResponse;
}>;
/**
 * Generate secure invite code
 */
export declare function generateInviteCode(length?: number): string;
/**
 * Set custom claims for user
 */
export declare function setUserClaims(uid: string, claims: {
    role?: UserRole;
    familyId?: string;
}): Promise<void>;
/**
 * Revoke all refresh tokens for a user
 */
export declare function revokeUserTokens(uid: string): Promise<void>;
/**
 * Delete user account
 */
export declare function deleteUserAccount(uid: string): Promise<void>;
/**
 * Validate CORS origin
 */
export declare function validateCorsOrigin(origin: string): boolean;
/**
 * Simplified authentication function for use in Plaid functions
 * Returns user and decoded token for authenticated requests
 * Handles both HTTP requests and Firebase Functions v2 callable requests
 */
export declare function authenticateRequest(request: any, requiredRole?: UserRole): Promise<{
    user: admin.auth.DecodedIdToken;
    userData: User;
}>;
//# sourceMappingURL=auth.d.ts.map