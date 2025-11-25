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
exports.createGroup = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
const auth_1 = require("../../../../utils/auth");
const validation_1 = require("../../../../utils/validation");
const cors_1 = require("../../../../middleware/cors");
/**
 * Create a new group
 */
exports.createGroup = (0, https_1.onRequest)({
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
            // Check if user already belongs to a group (check familyId field which stores groupId)
            if (user.familyId) {
                return response.status(400).json((0, auth_1.createErrorResponse)("already-in-group", "User already belongs to a group"));
            }
            // Validate request body
            const validation = (0, validation_1.validateRequest)(request.body, validation_1.createFamilySchema);
            if (validation.error) {
                return response.status(400).json((0, auth_1.createErrorResponse)("validation-error", validation.error));
            }
            const groupData = validation.value;
            // Default group settings
            const defaultSettings = Object.assign({ allowMemberInvites: true, requireApprovalForSharing: false, defaultResourceRole: types_1.GroupRole.VIEWER, maxMembers: 10 }, groupData.settings);
            // Create founding member
            const foundingMember = {
                userId: user.id,
                role: types_1.GroupRole.OWNER,
                joinedAt: admin.firestore.Timestamp.now(),
                invitedBy: user.id,
                status: 'active'
            };
            // Create group document
            const group = {
                name: groupData.name,
                description: groupData.description,
                createdBy: user.id,
                ownerId: user.id,
                members: [foundingMember],
                settings: defaultSettings,
                isActive: true,
            };
            // Execute transaction to create group and update user
            const result = await (0, firestore_1.executeTransaction)(async (transaction) => {
                // Create group in both collections (groups is primary, families for backward compatibility)
                const groupRef = admin.firestore().collection("groups").doc();
                transaction.set(groupRef, Object.assign(Object.assign({}, group), { createdAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now() }));
                // Also create in families collection for backward compatibility
                const familyRef = admin.firestore().collection("families").doc(groupRef.id);
                transaction.set(familyRef, Object.assign(Object.assign({}, group), { createdAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now() }));
                // Update user with group ID and admin role (store in familyId for backward compatibility)
                const userRef = admin.firestore().collection("users").doc(user.id);
                transaction.update(userRef, {
                    familyId: groupRef.id, // Store groupId in familyId field for backward compatibility
                    role: types_1.UserRole.ADMIN,
                    updatedAt: admin.firestore.Timestamp.now(),
                });
                return {
                    groupId: groupRef.id,
                    group: Object.assign(Object.assign({ id: groupRef.id }, group), { createdAt: admin.firestore.Timestamp.now(), updatedAt: admin.firestore.Timestamp.now() }),
                };
            });
            // Update user custom claims (keep using UserRole.ADMIN for backward compatibility)
            await (0, auth_1.setUserClaims)(user.id, {
                role: types_1.UserRole.ADMIN,
                familyId: result.groupId // Backward compatibility - store groupId in familyId field
            });
            return response.status(201).json((0, auth_1.createSuccessResponse)(result.group));
        }
        catch (error) {
            console.error("Error creating group:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to create group"));
        }
    });
});
//# sourceMappingURL=createGroup.js.map