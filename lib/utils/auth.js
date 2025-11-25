"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserRole = void 0;
exports.verifyAuthToken = verifyAuthToken;
exports.getUserWithRole = getUserWithRole;
exports.hasRequiredRole = hasRequiredRole;
exports.checkFamilyAccess = checkFamilyAccess;
exports.checkUserAccess = checkUserAccess;
exports.createErrorResponse = createErrorResponse;
exports.createSuccessResponse = createSuccessResponse;
exports.authMiddleware = authMiddleware;
exports.generateInviteCode = generateInviteCode;
exports.setUserClaims = setUserClaims;
exports.revokeUserTokens = revokeUserTokens;
exports.deleteUserAccount = deleteUserAccount;
exports.validateCorsOrigin = validateCorsOrigin;
exports.authenticateRequest = authenticateRequest;
const admin = __importStar(require("firebase-admin"));
const types_1 = require("../types");
const firestore_1 = require("./firestore");
// Re-export UserRole for use in other modules
var types_2 = require("../types");
Object.defineProperty(exports, "UserRole", { enumerable: true, get: function () { return types_2.UserRole; } });
/**
 * Middleware to verify Firebase Auth token
 */
async function verifyAuthToken(idToken) {
    try {
        return await admin.auth().verifyIdToken(idToken);
    }
    catch (error) {
        throw new Error(`Invalid authentication token: ${error.message}`);
    }
}
/**
 * Get user document with role information
 */
async function getUserWithRole(uid) {
    try {
        const user = await (0, firestore_1.getDocument)("users", uid);
        return user;
    }
    catch (error) {
        console.error(`Error fetching user ${uid}:`, error);
        return null;
    }
}
/**
 * Check if user has required role
 */
function hasRequiredRole(userRole, requiredRole) {
    const roleHierarchy = {
        [types_1.UserRole.VIEWER]: 1,
        [types_1.UserRole.EDITOR]: 2,
        [types_1.UserRole.ADMIN]: 3,
    };
    return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}
/**
 * Check if user belongs to the same family
 */
async function checkFamilyAccess(userId, targetFamilyId) {
    try {
        const user = await getUserWithRole(userId);
        return (user === null || user === void 0 ? void 0 : user.familyId) === targetFamilyId;
    }
    catch (error) {
        console.error(`Error checking family access for user ${userId}:`, error);
        return false;
    }
}
/**
 * Check if user can access another user's data
 */
async function checkUserAccess(requestingUserId, targetUserId) {
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
        if (requestingUser.role === types_1.UserRole.ADMIN) {
            return true;
        }
        return false;
    }
    catch (error) {
        console.error("Error checking user access:", error);
        return false;
    }
}
/**
 * Create standardized error responses
 */
function createErrorResponse(code, message, details) {
    const error = Object.assign({ code,
        message }, (details && { details }));
    return {
        success: false,
        error,
        timestamp: new Date().toISOString(),
    };
}
/**
 * Create standardized success responses
 */
function createSuccessResponse(data) {
    return Object.assign(Object.assign({ success: true }, (data !== undefined && { data })), { timestamp: new Date().toISOString() });
}
/**
 * Authentication middleware for HTTP functions
 */
async function authMiddleware(request, requiredRole = types_1.UserRole.VIEWER) {
    try {
        // Check for Authorization header
        const authHeader = request.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return {
                success: false,
                error: createErrorResponse("auth/missing-token", "Authorization header with Bearer token is required"),
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
                error: createErrorResponse("auth/user-not-found", "User document not found"),
            };
        }
        // Check if user is active
        if (!user.isActive) {
            return {
                success: false,
                error: createErrorResponse("auth/user-inactive", "User account is inactive"),
            };
        }
        // Check role permissions
        if (!hasRequiredRole(user.role, requiredRole)) {
            return {
                success: false,
                error: createErrorResponse("auth/insufficient-permissions", `Required role: ${requiredRole}, user role: ${user.role}`),
            };
        }
        return {
            success: true,
            user,
            decodedToken,
        };
    }
    catch (error) {
        console.error("Authentication middleware error:", error);
        return {
            success: false,
            error: createErrorResponse("auth/verification-failed", error.message || "Token verification failed"),
        };
    }
}
/**
 * Generate secure invite code
 */
function generateInviteCode(length = 8) {
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
async function setUserClaims(uid, claims) {
    try {
        await admin.auth().setCustomUserClaims(uid, claims);
    }
    catch (error) {
        console.error(`Error setting custom claims for user ${uid}:`, error);
        throw error;
    }
}
/**
 * Revoke all refresh tokens for a user
 */
async function revokeUserTokens(uid) {
    try {
        await admin.auth().revokeRefreshTokens(uid);
    }
    catch (error) {
        console.error(`Error revoking tokens for user ${uid}:`, error);
        throw error;
    }
}
/**
 * Delete user account
 */
async function deleteUserAccount(uid) {
    try {
        await admin.auth().deleteUser(uid);
    }
    catch (error) {
        console.error(`Error deleting user account ${uid}:`, error);
        throw error;
    }
}
/**
 * Validate CORS origin
 */
function validateCorsOrigin(origin) {
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
/**
 * Simplified authentication function for use in Plaid functions
 * Returns user and decoded token for authenticated requests
 * Handles both HTTP requests and Firebase Functions v2 callable requests
 */
async function authenticateRequest(request, requiredRole = types_1.UserRole.VIEWER) {
    let authHeader;
    // Handle different request types
    if (request.get && typeof request.get === 'function') {
        // HTTP request (Express-style)
        authHeader = request.get("Authorization");
    }
    else if (request.headers && request.headers.authorization) {
        // HTTP request with headers object
        authHeader = request.headers.authorization;
    }
    else if (request.auth && request.auth.token) {
        // Firebase Functions v2 callable request - already authenticated
        const decodedToken = request.auth.token;
        // Get user document with role
        const userData = await getUserWithRole(decodedToken.uid);
        if (!userData) {
            throw new Error("User document not found");
        }
        // Check if user is active
        if (!userData.isActive) {
            throw new Error("User account is inactive");
        }
        // Check role permissions
        if (!hasRequiredRole(userData.role, requiredRole)) {
            throw new Error(`Required role: ${requiredRole}, user role: ${userData.role}`);
        }
        return {
            user: decodedToken,
            userData,
        };
    }
    else {
        throw new Error("Authorization header with Bearer token is required");
    }
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new Error("Authorization header with Bearer token is required");
    }
    const idToken = authHeader.split("Bearer ")[1];
    // Verify the token
    const decodedToken = await verifyAuthToken(idToken);
    // Get user document with role
    const userData = await getUserWithRole(decodedToken.uid);
    if (!userData) {
        throw new Error("User document not found");
    }
    // Check if user is active
    if (!userData.isActive) {
        throw new Error("User account is inactive");
    }
    // Check role permissions
    if (!hasRequiredRole(userData.role, requiredRole)) {
        throw new Error(`Required role: ${requiredRole}, user role: ${userData.role}`);
    }
    return {
        user: decodedToken,
        userData,
    };
}
//# sourceMappingURL=auth.js.map