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
exports.generateGroupInvite = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
const auth_1 = require("../../../../utils/auth");
const validation_1 = require("../../../../utils/validation");
const cors_1 = require("../../../../middleware/cors");
/**
 * Generate group invite code
 */
exports.generateGroupInvite = (0, https_1.onRequest)({
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
            // Authenticate user (parent or admin can create invites)
            const authResult = await (0, auth_1.authMiddleware)(request, types_1.UserRole.EDITOR);
            if (!authResult.success || !authResult.user) {
                return response.status(401).json(authResult.error);
            }
            const { user } = authResult;
            // Get groupId (stored as familyId for backward compatibility)
            const groupId = user.familyId;
            if (!groupId) {
                return response.status(400).json((0, auth_1.createErrorResponse)("no-group", "User does not belong to any group"));
            }
            // Validate request body
            const validation = (0, validation_1.validateRequest)(request.body, validation_1.inviteCodeSchema);
            if (validation.error) {
                return response.status(400).json((0, auth_1.createErrorResponse)("validation-error", validation.error));
            }
            const { role, expiresInHours } = validation.value;
            // Try to get group from groups collection first, fallback to families collection
            let group = await (0, firestore_1.getDocument)("groups", groupId);
            if (!group) {
                // Backward compatibility: try families collection
                group = await (0, firestore_1.getDocument)("families", groupId);
            }
            if (!group) {
                return response.status(404).json((0, auth_1.createErrorResponse)("group-not-found", "Group not found"));
            }
            // Generate unique invite code
            let inviteCode;
            let codeExists = true;
            while (codeExists) {
                inviteCode = (0, auth_1.generateInviteCode)(8);
                // Check if code already exists in any group or family
                const [existingGroup, existingFamily] = await Promise.all([
                    admin.firestore()
                        .collection("groups")
                        .where("inviteCodes", "array-contains-any", [inviteCode])
                        .get(),
                    admin.firestore()
                        .collection("families")
                        .where("inviteCodes", "array-contains-any", [inviteCode])
                        .get()
                ]);
                codeExists = !existingGroup.empty || !existingFamily.empty;
            }
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + expiresInHours);
            const newInviteCode = {
                code: inviteCode,
                createdAt: admin.firestore.Timestamp.now(),
                expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
                role,
                isActive: true,
            };
            // Add invite code to group
            const updatedInviteCodes = [...group.inviteCodes, newInviteCode];
            // Update groups collection
            await (0, firestore_1.updateDocument)("groups", groupId, {
                inviteCodes: updatedInviteCodes,
            });
            // Backward compatibility: also update families collection
            await (0, firestore_1.updateDocument)("families", groupId, {
                inviteCodes: updatedInviteCodes,
            });
            return response.status(201).json((0, auth_1.createSuccessResponse)({
                inviteCode: inviteCode,
                role,
                expiresAt: expiresAt.toISOString(),
            }));
        }
        catch (error) {
            console.error("Error generating group invite:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to generate invite code"));
        }
    });
});
//# sourceMappingURL=generateGroupInvite.js.map