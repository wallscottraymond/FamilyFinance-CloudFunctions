"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshUserSession = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../types");
const firestore_1 = require("../../utils/firestore");
const auth_1 = require("../../utils/auth");
const cors_1 = require("../../middleware/cors");
/**
 * Refresh user session with updated claims
 */
exports.refreshUserSession = (0, https_1.onRequest)({
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
            const { user, decodedToken } = authResult;
            // Get the latest user document to check for updates
            const currentUser = await (0, firestore_1.getDocument)("users", user.id);
            if (!currentUser) {
                return response.status(404).json((0, auth_1.createErrorResponse)("user-not-found", "User document not found"));
            }
            // Check if claims need to be updated
            const currentClaims = decodedToken.role || types_1.UserRole.VIEWER;
            const currentFamilyId = decodedToken.familyId;
            const needsUpdate = currentClaims !== currentUser.role ||
                currentFamilyId !== currentUser.familyId;
            if (needsUpdate) {
                // Update custom claims
                await (0, auth_1.setUserClaims)(user.id, {
                    role: currentUser.role,
                    familyId: currentUser.familyId,
                });
                return response.status(200).json((0, auth_1.createSuccessResponse)({
                    updated: true,
                    message: "Session refreshed. Please get a new ID token.",
                    user: {
                        id: currentUser.id,
                        email: currentUser.email,
                        displayName: currentUser.displayName,
                        role: currentUser.role,
                        familyId: currentUser.familyId,
                        isActive: currentUser.isActive,
                    },
                }));
            }
            return response.status(200).json((0, auth_1.createSuccessResponse)({
                updated: false,
                message: "Session is up to date",
                user: {
                    id: currentUser.id,
                    email: currentUser.email,
                    displayName: currentUser.displayName,
                    role: currentUser.role,
                    familyId: currentUser.familyId,
                    isActive: currentUser.isActive,
                },
            }));
        }
        catch (error) {
            console.error("Error refreshing user session:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to refresh session"));
        }
    });
});
//# sourceMappingURL=refreshUserSession.js.map