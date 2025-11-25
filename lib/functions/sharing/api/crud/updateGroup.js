"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateGroup = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
const auth_1 = require("../../../../utils/auth");
const cors_1 = require("../../../../middleware/cors");
/**
 * Update group settings
 */
exports.updateGroup = (0, https_1.onRequest)({
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
            // Authenticate user (only admin can update group)
            const authResult = await (0, auth_1.authMiddleware)(request, types_1.UserRole.ADMIN);
            if (!authResult.success || !authResult.user) {
                return response.status(401).json(authResult.error);
            }
            const { user } = authResult;
            // Get groupId (stored as familyId for backward compatibility)
            const groupId = user.familyId;
            if (!groupId) {
                return response.status(400).json((0, auth_1.createErrorResponse)("no-group", "User does not belong to any group"));
            }
            const updateData = request.body;
            // Try to get group from groups collection first, fallback to families collection
            let group = await (0, firestore_1.getDocument)("groups", groupId);
            let isLegacyFamily = false;
            if (!group) {
                // Backward compatibility: try families collection
                group = await (0, firestore_1.getDocument)("families", groupId);
                isLegacyFamily = true;
            }
            // Validate that user is admin of this group
            if (!group || group.adminUserId !== user.id) {
                return response.status(403).json((0, auth_1.createErrorResponse)("not-group-admin", "Only group admin can update group settings"));
            }
            // Update group in groups collection
            const updatedGroup = await (0, firestore_1.updateDocument)("groups", groupId, updateData);
            // Backward compatibility: also update families collection if it exists there
            if (isLegacyFamily) {
                await (0, firestore_1.updateDocument)("families", groupId, updateData);
            }
            return response.status(200).json((0, auth_1.createSuccessResponse)(updatedGroup));
        }
        catch (error) {
            console.error("Error updating group:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to update group"));
        }
    });
});
//# sourceMappingURL=updateGroup.js.map