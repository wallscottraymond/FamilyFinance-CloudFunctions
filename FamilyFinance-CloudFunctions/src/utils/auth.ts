import * as admin from "firebase-admin";
import { User, UserRole, FunctionResponse, ApiError } from "../types";
import { getDocument } from "./firestore";

/**
 * Middleware to verify Firebase Auth token
 */
export async function verifyAuthToken(
  idToken: string
): Promise<admin.auth.DecodedIdToken> {
  try {
    return await admin.auth().verifyIdToken(idToken);
  } catch (error: any) {
    throw new Error(`Invalid authentication token: ${error.message}`);
  }
}

/**
 * Get user document with role information
 */
export async function getUserWithRole(uid: string): Promise<User | null> {
  try {
    const user = await getDocument<User>("users", uid);
    return user;
  } catch (error) {
    console.error(`Error fetching user ${uid}:`, error);
    return null;
  }
}

/**
 * Check if user has required role
 */
export function hasRequiredRole(
  userRole: UserRole,
  requiredRole: UserRole
): boolean {
  const roleHierarchy = {
    [UserRole.VIEWER]: 1,
    [UserRole.CHILD]: 2,
    [UserRole.PARENT]: 3,
    [UserRole.ADMIN]: 4,
  };

  return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

/**
 * Check if user belongs to the same family
 */
export async function checkFamilyAccess(
  userId: string,
  targetFamilyId: string
): Promise<boolean> {
  try {
    const user = await getUserWithRole(userId);
    return user?.familyId === targetFamilyId;
  } catch (error) {
    console.error(`Error checking family access for user ${userId}:`, error);
    return false;
  }
}

/**
 * Check if user can access another user's data
 */
export async function checkUserAccess(
  requestingUserId: string,
  targetUserId: string
): Promise<boolean> {
  // Users can always access their own data
  if (requestingUserId === targetUserId) {
    return true;
  }

  try {
    const requestingUser = await getUserWithRole(requestingUserId);
    const targetUser = await getUserWithRole(targetUserId);

    if (!requestingUser || !targetUser) {
      return false;
    }

    // Must be in the same family
    if (requestingUser.familyId !== targetUser.familyId) {
      return false;
    }

    // Admin can access anyone in the family
    if (requestingUser.role === UserRole.ADMIN) {
      return true;
    }

    // Parents can access children's data
    if (requestingUser.role === UserRole.PARENT && 
        targetUser.role === UserRole.CHILD) {
      return true;
    }

    return false;
  } catch (error) {
    console.error("Error checking user access:", error);
    return false;
  }
}

/**
 * Create standardized error responses
 */
export function createErrorResponse(
  code: string,
  message: string,
  details?: Record<string, any>
): FunctionResponse {
  const error: ApiError = {
    code,
    message,
    ...(details && { details }),
  };

  return {
    success: false,
    error,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create standardized success responses
 */
export function createSuccessResponse<T>(
  data?: T
): FunctionResponse<T> {
  return {
    success: true,
    ...(data !== undefined && { data }),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Authentication middleware for HTTP functions
 */
export async function authMiddleware(
  request: any,
  requiredRole: UserRole = UserRole.VIEWER
): Promise<{
  success: boolean;
  user?: User;
  decodedToken?: admin.auth.DecodedIdToken;
  error?: FunctionResponse;
}> {
  try {
    // Check for Authorization header
    const authHeader = request.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return {
        success: false,
        error: createErrorResponse(
          "auth/missing-token",
          "Authorization header with Bearer token is required"
        ),
      };
    }

    const idToken = authHeader.split("Bearer ")[1];
    
    // Verify the token
    const decodedToken = await verifyAuthToken(idToken);
    
    // Get user document with role
    const user = await getUserWithRole(decodedToken.uid);
    if (!user) {
      return {
        success: false,
        error: createErrorResponse(
          "auth/user-not-found",
          "User document not found"
        ),
      };
    }

    // Check if user is active
    if (!user.isActive) {
      return {
        success: false,
        error: createErrorResponse(
          "auth/user-inactive",
          "User account is inactive"
        ),
      };
    }

    // Check role permissions
    if (!hasRequiredRole(user.role, requiredRole)) {
      return {
        success: false,
        error: createErrorResponse(
          "auth/insufficient-permissions",
          `Required role: ${requiredRole}, user role: ${user.role}`
        ),
      };
    }

    return {
      success: true,
      user,
      decodedToken,
    };
  } catch (error: any) {
    console.error("Authentication middleware error:", error);
    return {
      success: false,
      error: createErrorResponse(
        "auth/verification-failed",
        error.message || "Token verification failed"
      ),
    };
  }
}

/**
 * Generate secure invite code
 */
export function generateInviteCode(length: number = 8): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Set custom claims for user
 */
export async function setUserClaims(
  uid: string,
  claims: { role?: UserRole; familyId?: string }
): Promise<void> {
  try {
    await admin.auth().setCustomUserClaims(uid, claims);
  } catch (error: any) {
    console.error(`Error setting custom claims for user ${uid}:`, error);
    throw error;
  }
}

/**
 * Revoke all refresh tokens for a user
 */
export async function revokeUserTokens(uid: string): Promise<void> {
  try {
    await admin.auth().revokeRefreshTokens(uid);
  } catch (error: any) {
    console.error(`Error revoking tokens for user ${uid}:`, error);
    throw error;
  }
}

/**
 * Delete user account
 */
export async function deleteUserAccount(uid: string): Promise<void> {
  try {
    await admin.auth().deleteUser(uid);
  } catch (error: any) {
    console.error(`Error deleting user account ${uid}:`, error);
    throw error;
  }
}

/**
 * Validate CORS origin
 */
export function validateCorsOrigin(origin: string): boolean {
  const allowedOrigins = [
    "http://localhost:3000",
    "http://localhost:8081", // React Native dev
    "https://family-finance-app.web.app",
    "https://family-finance-app.firebaseapp.com",
  ];

  // Add environment-specific origins
  if (process.env.NODE_ENV === "development") {
    allowedOrigins.push("http://localhost:8080", "http://127.0.0.1:3000");
  }

  return allowedOrigins.includes(origin) || origin.startsWith("http://localhost:");
}