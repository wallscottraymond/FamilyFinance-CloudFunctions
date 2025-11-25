"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGroup = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
const auth_1 = require("../../../../utils/auth");
const cors_1 = require("../../../../middleware/cors");
/**
 * Get group details
 */
exports.getGroup = (0, https_1.onRequest)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
    cors: true
}, async (request, response) => {
    return (0, cors_1.firebaseCors)(request, response, async () => {
        if (request.method !== "GET") {
            return response.status(405).json((0, auth_1.createErrorResponse)("method-not-allowed", "Only GET requests are allowed"));
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
                return response.status(404).json((0, auth_1.createErrorResponse)("no-group", "User does not belong to any group"));
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
            // Get group members details
            const memberPromises = group.memberIds.map(memberId => (0, firestore_1.getDocument)("users", memberId));
            const members = (await Promise.all(memberPromises)).filter(member => member !== null);
            const groupWithMembers = Object.assign(Object.assign({}, group), { members: members.map(member => ({
                    id: member.id,
                    email: member.email,
                    displayName: member.displayName,
                    photoURL: member.photoURL,
                    role: member.role,
                    isActive: member.isActive,
                })) });
            return response.status(200).json((0, auth_1.createSuccessResponse)(groupWithMembers));
        }
        catch (error) {
            console.error("Error getting group:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to get group"));
        }
    });
});
//# sourceMappingURL=getGroup.js.map