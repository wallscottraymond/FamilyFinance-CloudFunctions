import { onRequest } from "firebase-functions/v2/https";
import { 
  UserRole
} from "../../types";
import { 
  getDocument
} from "../../utils/firestore";
import { 
  authMiddleware, 
  createErrorResponse, 
  createSuccessResponse
} from "../../utils/auth";
import { firebaseCors } from "../../middleware/cors";

/**
 * Get user permissions for current family
 */
export const getUserPermissions = onRequest({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
  cors: true
}, async (request, response) => {
  return firebaseCors(request, response, async () => {
    if (request.method !== "GET") {
      return response.status(405).json(
        createErrorResponse("method-not-allowed", "Only GET requests are allowed")
      );
    }

    try {
      // Authenticate user
      const authResult = await authMiddleware(request, UserRole.VIEWER);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;

      // Define permissions based on role
      const rolePermissions = {
        [UserRole.ADMIN]: {
          canCreateTransactions: true,
          canEditAllTransactions: true,
          canDeleteAllTransactions: true,
          canApproveTransactions: true,
          canCreateBudgets: true,
          canEditAllBudgets: true,
          canViewAllTransactions: true,
          canManageFamily: true,
          canInviteMembers: true,
          canRemoveMembers: true,
          canChangeRoles: true,
          canViewReports: true,
        },
        [UserRole.EDITOR]: {
          canCreateTransactions: true,
          canEditOwnTransactions: true,
          canDeleteOwnTransactions: true,
          canApproveTransactions: true,
          canCreateBudgets: true,
          canEditOwnBudgets: true,
          canViewAllTransactions: true,
          canManageFamily: false,
          canInviteMembers: true,
          canRemoveMembers: false,
          canChangeRoles: false,
          canViewReports: true,
        },
        [UserRole.VIEWER]: {
          canCreateTransactions: false,
          canEditOwnTransactions: false,
          canDeleteOwnTransactions: false,
          canApproveTransactions: false,
          canCreateBudgets: false,
          canEditOwnBudgets: false,
          canViewOwnTransactions: true,
          canManageFamily: false,
          canInviteMembers: false,
          canRemoveMembers: false,
          canChangeRoles: false,
          canViewReports: false,
        },
      };

      // Get family settings if user belongs to a family
      let familySettings = null;
      if (user.familyId) {
        const family = await getDocument("families", user.familyId);
        familySettings = (family as any)?.settings || null;
      }

      const permissions = rolePermissions[user.role];

      // Adjust permissions based on family settings
      if (familySettings) {
        // If children transactions are disabled, override child permissions
        if (!(familySettings as any).allowViewerTransactions && user.role === UserRole.VIEWER) {
          permissions.canCreateTransactions = false;
        }
      }

      return response.status(200).json(createSuccessResponse({
        userId: user.id,
        role: user.role,
        familyId: user.familyId,
        permissions,
        familySettings,
      }));

    } catch (error: any) {
      console.error("Error getting user permissions:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to get user permissions")
      );
    }
  });
});