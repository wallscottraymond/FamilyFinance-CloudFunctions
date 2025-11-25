import { onRequest } from "firebase-functions/v2/https";
import { 
  UserRole
} from "../../types";
import { 
  authMiddleware, 
  createErrorResponse, 
  createSuccessResponse
} from "../../utils/auth";
import { firebaseCors } from "../../middleware/cors";

/**
 * Validate authentication token
 */
export const validateToken = onRequest({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
  cors: true
}, async (request, response) => {
  return firebaseCors(request, response, async () => {
    if (request.method !== "POST") {
      return response.status(405).json(
        createErrorResponse("method-not-allowed", "Only POST requests are allowed")
      );
    }

    try {
      // Authenticate user
      const authResult = await authMiddleware(request, UserRole.VIEWER);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user, decodedToken } = authResult;

      return response.status(200).json(createSuccessResponse({
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
          uid: decodedToken!.uid,
          email: decodedToken!.email,
          role: decodedToken!.role,
          familyId: decodedToken!.familyId,
          iat: decodedToken!.iat,
          exp: decodedToken!.exp,
        },
      }));

    } catch (error: any) {
      console.error("Error validating token:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to validate token")
      );
    }
  });
});