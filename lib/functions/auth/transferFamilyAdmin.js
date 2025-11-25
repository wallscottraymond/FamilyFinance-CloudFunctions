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
exports.transferFamilyAdmin = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const types_1 = require("../../types");
const firestore_1 = require("../../utils/firestore");
const auth_1 = require("../../utils/auth");
const cors_1 = require("../../middleware/cors");
/**
 * Transfer family admin role
 */
exports.transferFamilyAdmin = (0, https_1.onRequest)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 60,
    cors: true
}, async (request, response) => {
    return (0, cors_1.firebaseCors)(request, response, async () => {
        if (request.method !== "POST") {
            return response.status(405).json((0, auth_1.createErrorResponse)("method-not-allowed", "Only POST requests are allowed"));
        }
        try {
            // Authenticate user (only current admin can transfer)
            const authResult = await (0, auth_1.authMiddleware)(request, types_1.UserRole.ADMIN);
            if (!authResult.success || !authResult.user) {
                return response.status(401).json(authResult.error);
            }
            const { user: currentAdmin } = authResult;
            const { newAdminUserId } = request.body;
            if (!newAdminUserId) {
                return response.status(400).json((0, auth_1.createErrorResponse)("missing-parameter", "New admin user ID is required"));
            }
            if (!currentAdmin.familyId) {
                return response.status(400).json((0, auth_1.createErrorResponse)("no-family", "Current admin must belong to a family"));
            }
            // Cannot transfer to self
            if (newAdminUserId === currentAdmin.id) {
                return response.status(400).json((0, auth_1.createErrorResponse)("invalid-transfer", "Cannot transfer admin role to yourself"));
            }
            // Get new admin user
            const newAdminUser = await (0, firestore_1.getDocument)("users", newAdminUserId);
            if (!newAdminUser) {
                return response.status(404).json((0, auth_1.createErrorResponse)("user-not-found", "New admin user not found"));
            }
            // Check if new admin is in the same family
            if (newAdminUser.familyId !== currentAdmin.familyId) {
                return response.status(403).json((0, auth_1.createErrorResponse)("different-family", "New admin must be a family member"));
            }
            // Get family document
            const family = await (0, firestore_1.getDocument)("families", currentAdmin.familyId);
            if (!family || family.adminUserId !== currentAdmin.id) {
                return response.status(403).json((0, auth_1.createErrorResponse)("not-family-admin", "Only current family admin can transfer admin role"));
            }
            // Execute transaction to transfer admin role
            await admin.firestore().runTransaction(async (transaction) => {
                // Update family admin
                const familyRef = admin.firestore().collection("families").doc(currentAdmin.familyId);
                transaction.update(familyRef, {
                    adminUserId: newAdminUserId,
                    updatedAt: admin.firestore.Timestamp.now(),
                });
                // Update new admin user role
                const newAdminRef = admin.firestore().collection("users").doc(newAdminUserId);
                transaction.update(newAdminRef, {
                    role: types_1.UserRole.ADMIN,
                    updatedAt: admin.firestore.Timestamp.now(),
                });
                // Update current admin role to parent
                const currentAdminRef = admin.firestore().collection("users").doc(currentAdmin.id);
                transaction.update(currentAdminRef, {
                    role: types_1.UserRole.EDITOR,
                    updatedAt: admin.firestore.Timestamp.now(),
                });
            });
            // Update custom claims for both users
            await Promise.all([
                (0, auth_1.setUserClaims)(newAdminUserId, {
                    role: types_1.UserRole.ADMIN,
                    familyId: currentAdmin.familyId,
                }),
                (0, auth_1.setUserClaims)(currentAdmin.id, {
                    role: types_1.UserRole.EDITOR,
                    familyId: currentAdmin.familyId,
                }),
            ]);
            // Force token refresh for both users
            await Promise.all([
                (0, auth_1.revokeUserTokens)(newAdminUserId),
                (0, auth_1.revokeUserTokens)(currentAdmin.id),
            ]);
            return response.status(200).json((0, auth_1.createSuccessResponse)({
                transferred: true,
                previousAdmin: {
                    id: currentAdmin.id,
                    email: currentAdmin.email,
                    displayName: currentAdmin.displayName,
                    newRole: types_1.UserRole.EDITOR,
                },
                newAdmin: {
                    id: newAdminUserId,
                    email: newAdminUser.email,
                    displayName: newAdminUser.displayName,
                    role: types_1.UserRole.ADMIN,
                },
            }));
        }
        catch (error) {
            console.error("Error transferring family admin:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to transfer admin role"));
        }
    });
});
//# sourceMappingURL=transferFamilyAdmin.js.map