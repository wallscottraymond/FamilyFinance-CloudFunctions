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
exports.leaveGroup = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
const auth_1 = require("../../../../utils/auth");
const cors_1 = require("../../../../middleware/cors");
/**
 * Leave group
 */
exports.leaveGroup = (0, https_1.onRequest)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
    cors: true
}, async (request, response) => {
    return (0, cors_1.firebaseCors)(request, response, async () => {
        if (request.method !== "POST") {
            return response.status(405).json((0, auth_1.createErrorResponse)("method-not-allowed", "Only POST requests are allowed"));
        }
        try {
            // Authenticate user
            const authResult = await (0, auth_1.authMiddleware)(request, types_1.UserRole.VIEWER);
            if (!authResult.success || !authResult.user) {
                return response.status(401).json(authResult.error);
            }
            const { user } = authResult;
            // Get groupId (stored as familyId for backward compatibility)
            const groupId = user.familyId;
            if (!groupId) {
                return response.status(400).json((0, auth_1.createErrorResponse)("no-group", "User is not part of any group"));
            }
            // Try to get group from groups collection first, fallback to families collection
            let group = await (0, firestore_1.getDocument)("groups", groupId);
            if (!group) {
                // Backward compatibility: try families collection
                group = await (0, firestore_1.getDocument)("families", groupId);
            }
            if (!group) {
                return response.status(404).json((0, auth_1.createErrorResponse)("group-not-found", "Group not found"));
            }
            // Check if user is the only admin
            if (group.adminUserId === user.id && group.memberIds.length > 1) {
                return response.status(400).json((0, auth_1.createErrorResponse)("transfer-admin-first", "Cannot leave group as the only admin. Transfer admin role to another member first."));
            }
            // Execute transaction to leave group
            await (0, firestore_1.executeTransaction)(async (transaction) => {
                const isLastMember = group.memberIds.length === 1;
                // Update group in groups collection
                const groupRef = admin.firestore().collection("groups").doc(groupId);
                if (isLastMember) {
                    // If this is the last member, deactivate the group
                    transaction.set(groupRef, Object.assign(Object.assign({}, group), { isActive: false, updatedAt: admin.firestore.Timestamp.now() }), { merge: true });
                }
                else {
                    // Remove user from group members
                    transaction.update(groupRef, {
                        memberIds: admin.firestore.FieldValue.arrayRemove(user.id),
                        updatedAt: admin.firestore.Timestamp.now(),
                    });
                }
                // Backward compatibility: also update families collection
                const familyRef = admin.firestore().collection("families").doc(groupId);
                if (isLastMember) {
                    transaction.set(familyRef, Object.assign(Object.assign({}, group), { isActive: false, updatedAt: admin.firestore.Timestamp.now() }), { merge: true });
                }
                else {
                    transaction.update(familyRef, {
                        memberIds: admin.firestore.FieldValue.arrayRemove(user.id),
                        updatedAt: admin.firestore.Timestamp.now(),
                    });
                }
                // Update user - remove familyId (groupId stored as familyId), reset role
                const userRef = admin.firestore().collection("users").doc(user.id);
                transaction.update(userRef, {
                    familyId: admin.firestore.FieldValue.delete(),
                    role: types_1.UserRole.VIEWER,
                    updatedAt: admin.firestore.Timestamp.now(),
                });
            });
            // Update user custom claims
            await (0, auth_1.setUserClaims)(user.id, {
                role: types_1.UserRole.VIEWER
            });
            return response.status(200).json((0, auth_1.createSuccessResponse)({
                leftGroup: true,
                groupDeactivated: group.memberIds.length === 1
            }));
        }
        catch (error) {
            console.error("Error leaving group:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to leave group"));
        }
    });
});
//# sourceMappingURL=leaveGroup.js.map