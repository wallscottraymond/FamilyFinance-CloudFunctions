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
exports.joinGroup = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
const auth_1 = require("../../../../utils/auth");
const validation_1 = require("../../../../utils/validation");
const cors_1 = require("../../../../middleware/cors");
/**
 * Join group using invite code
 */
exports.joinGroup = (0, https_1.onRequest)({
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
            // Check if user already belongs to a group (stored as familyId for backward compatibility)
            if (user.familyId) {
                return response.status(400).json((0, auth_1.createErrorResponse)("already-in-group", "User already belongs to a group"));
            }
            // Validate request body
            const validation = (0, validation_1.validateRequest)(request.body, validation_1.joinFamilySchema);
            if (validation.error) {
                return response.status(400).json((0, auth_1.createErrorResponse)("validation-error", validation.error));
            }
            const { inviteCode } = validation.value;
            // Find group with the invite code - search both groups and families collections
            const [groupsSnapshot, familiesSnapshot] = await Promise.all([
                admin.firestore().collection("groups").get(),
                admin.firestore().collection("families").get()
            ]);
            let targetGroup = null;
            let validInviteCode = null;
            // Search groups collection first
            for (const doc of groupsSnapshot.docs) {
                const group = Object.assign({ id: doc.id }, doc.data());
                const invite = group.inviteCodes.find(code => code.code === inviteCode &&
                    code.isActive &&
                    code.expiresAt.toDate() > new Date() &&
                    !code.usedBy);
                if (invite) {
                    targetGroup = group;
                    validInviteCode = invite;
                    break;
                }
            }
            // Backward compatibility: search families collection if not found in groups
            if (!targetGroup) {
                for (const doc of familiesSnapshot.docs) {
                    const group = Object.assign({ id: doc.id }, doc.data());
                    const invite = group.inviteCodes.find(code => code.code === inviteCode &&
                        code.isActive &&
                        code.expiresAt.toDate() > new Date() &&
                        !code.usedBy);
                    if (invite) {
                        targetGroup = group;
                        validInviteCode = invite;
                        break;
                    }
                }
            }
            if (!targetGroup || !validInviteCode) {
                return response.status(404).json((0, auth_1.createErrorResponse)("invalid-invite", "Invalid or expired invite code"));
            }
            // Execute transaction to join group
            await (0, firestore_1.executeTransaction)(async (transaction) => {
                const updatedInviteCodes = targetGroup.inviteCodes.map(code => code.code === inviteCode
                    ? Object.assign(Object.assign({}, code), { usedBy: user.id, isActive: false }) : code);
                // Update group in groups collection - add user to members and mark invite code as used
                const groupRef = admin.firestore().collection("groups").doc(targetGroup.id);
                transaction.set(groupRef, Object.assign(Object.assign({}, targetGroup), { memberIds: admin.firestore.FieldValue.arrayUnion(user.id), inviteCodes: updatedInviteCodes, updatedAt: admin.firestore.Timestamp.now() }), { merge: true });
                // Backward compatibility: also update families collection
                const familyRef = admin.firestore().collection("families").doc(targetGroup.id);
                transaction.set(familyRef, Object.assign(Object.assign({}, targetGroup), { memberIds: admin.firestore.FieldValue.arrayUnion(user.id), inviteCodes: updatedInviteCodes, updatedAt: admin.firestore.Timestamp.now() }), { merge: true });
                // Update user with familyId (groupId stored as familyId for backward compatibility)
                const userRef = admin.firestore().collection("users").doc(user.id);
                transaction.update(userRef, {
                    familyId: targetGroup.id,
                    role: validInviteCode.role,
                    updatedAt: admin.firestore.Timestamp.now(),
                });
            });
            // Update user custom claims
            await (0, auth_1.setUserClaims)(user.id, {
                role: validInviteCode.role,
                familyId: targetGroup.id
            });
            return response.status(200).json((0, auth_1.createSuccessResponse)({
                groupId: targetGroup.id,
                groupName: targetGroup.name,
                role: validInviteCode.role,
            }));
        }
        catch (error) {
            console.error("Error joining group:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to join group"));
        }
    });
});
//# sourceMappingURL=joinGroup.js.map