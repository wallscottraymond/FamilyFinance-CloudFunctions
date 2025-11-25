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
exports.updateUserProfile = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const types_1 = require("../../types");
const firestore_1 = require("../../utils/firestore");
const auth_1 = require("../../utils/auth");
const cors_1 = require("../../middleware/cors");
const validation_1 = require("../../utils/validation");
/**
 * Update user profile
 */
exports.updateUserProfile = (0, https_1.onRequest)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
    cors: true
}, async (request, response) => {
    return (0, cors_1.firebaseCors)(request, response, async () => {
        if (request.method !== "PUT") {
            return response.status(405).json((0, auth_1.createErrorResponse)("method-not-allowed", "Only PUT requests are allowed"));
        }
        try {
            // Authenticate user
            const authResult = await (0, auth_1.authMiddleware)(request, types_1.UserRole.VIEWER);
            if (!authResult.success || !authResult.user) {
                return response.status(401).json(authResult.error);
            }
            const { user } = authResult;
            const targetUserId = request.query.userId || user.id;
            // Check if user can update target user's profile
            if (targetUserId !== user.id) {
                const hasAccess = await (0, auth_1.checkUserAccess)(user.id, targetUserId);
                if (!hasAccess) {
                    return response.status(403).json((0, auth_1.createErrorResponse)("access-denied", "Cannot update this user's profile"));
                }
            }
            // Validate request body
            const validation = (0, validation_1.validateRequest)(request.body, validation_1.updateUserSchema);
            if (validation.error) {
                return response.status(400).json((0, auth_1.createErrorResponse)("validation-error", validation.error));
            }
            const updateData = validation.value;
            // Update user profile
            const updatedUser = await (0, firestore_1.updateDocument)("users", targetUserId, updateData);
            // Update display name in Firebase Auth if changed
            if (updateData.displayName) {
                try {
                    await admin.auth().updateUser(targetUserId, {
                        displayName: updateData.displayName,
                    });
                }
                catch (error) {
                    console.warn(`Could not update display name in Auth for user ${targetUserId}:`, error);
                }
            }
            return response.status(200).json((0, auth_1.createSuccessResponse)(updatedUser));
        }
        catch (error) {
            console.error("Error updating user profile:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to update user profile"));
        }
    });
});
//# sourceMappingURL=updateUserProfile.js.map