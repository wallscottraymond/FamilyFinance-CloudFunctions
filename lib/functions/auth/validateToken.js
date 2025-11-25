"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateToken = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../types");
const auth_1 = require("../../utils/auth");
const cors_1 = require("../../middleware/cors");
/**
 * Validate authentication token
 */
exports.validateToken = (0, https_1.onRequest)({
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
            return response.status(200).json((0, auth_1.createSuccessResponse)({
                valid: true,
                user: {
                    id: user.id,
                    email: user.email,
                    displayName: user.displayName,
                    role: user.role,
                    familyId: user.familyId,
                    isActive: user.isActive,
                    preferences: user.preferences,
                },
                token: {
                    uid: decodedToken.uid,
                    email: decodedToken.email,
                    role: decodedToken.role,
                    familyId: decodedToken.familyId,
                    iat: decodedToken.iat,
                    exp: decodedToken.exp,
                },
            }));
        }
        catch (error) {
            console.error("Error validating token:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to validate token"));
        }
    });
});
//# sourceMappingURL=validateToken.js.map