import { onRequest } from "firebase-functions/v2/https";
import { 
  User, 
  UserRole
} from "../../types";
import { 
  getDocument
} from "../../utils/firestore";
import { 
  authMiddleware, 
  createErrorResponse, 
  createSuccessResponse,
  setUserClaims
} from "../../utils/auth";
import { firebaseCors } from "../../middleware/cors";

/**
 * Refresh user session with updated claims
 */
export const refreshUserSession = onRequest({
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

      // Get the latest user document to check for updates
      const currentUser = await getDocument<User>("users", user.id!);
      if (!currentUser) {
        return response.status(404).json(
          createErrorResponse("user-not-found", "User document not found")
        );
      }

      // Check if claims need to be updated
      const currentClaims = decodedToken!.role || UserRole.VIEWER;
      const currentFamilyId = decodedToken!.familyId;

      const needsUpdate = 
        currentClaims !== currentUser.role || 
        currentFamilyId !== currentUser.familyId;

      if (needsUpdate) {
        // Update custom claims
        await setUserClaims(user.id!, {
          role: currentUser.role,
          familyId: currentUser.familyId,
        });

        return response.status(200).json(createSuccessResponse({
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

      return response.status(200).json(createSuccessResponse({
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

    } catch (error: any) {
      console.error("Error refreshing user session:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to refresh session")
      );
    }
  });
});