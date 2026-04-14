import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  GetUserSharedResourcesRequest,
  GetUserSharedResourcesResponse,
  ResourceRole,
  User,
} from "../../../../types";
import { getDocument } from "../../../../utils/firestore";

// Map resource types to collection names
const RESOURCE_COLLECTIONS: Record<string, string> = {
  budget: 'budgets',
  transaction: 'transactions',
  outflow: 'outflows',
  inflow: 'inflows',
  rule: 'rules',
};

const ALL_RESOURCE_TYPES = ['budget', 'transaction', 'outflow', 'inflow', 'rule'];

/**
 * Get all resources shared with the current user
 *
 * Returns resources that are:
 * 1. Directly shared with the user
 * 2. Shared with groups the user is a member of
 * 3. Optionally, owned by the user
 */
export const getUserSharedResources = onCall<GetUserSharedResourcesRequest, Promise<GetUserSharedResourcesResponse>>({
  region: "us-central1",
  memory: "512MiB",
  timeoutSeconds: 60,
}, async (request) => {
  console.log('[getUserSharedResources] Function called with data:', JSON.stringify(request.data, null, 2));

  try {
    // Check authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const callerUserId = request.auth.uid;
    const { resourceType, includeOwned = false } = request.data || {};

    // Get the user's group memberships
    const user = await getDocument<User>('users', callerUserId);
    const userGroupIds: string[] = user?.groupIds || [];

    // Determine which resource types to query
    const typesToQuery = resourceType ? [resourceType] : ALL_RESOURCE_TYPES;

    const resources: Array<{
      resourceId: string;
      resourceType: string;
      accessLevel: ResourceRole;
      sharedBy: string;
      sharedAt: admin.firestore.Timestamp;
    }> = [];

    const db = admin.firestore();

    for (const type of typesToQuery) {
      const collectionName = RESOURCE_COLLECTIONS[type];
      if (!collectionName) continue;

      // Query for resources shared with user directly
      const directShareQuery = db.collection(collectionName)
        .where('sharing.isShared', '==', true)
        .where('isActive', '==', true);

      const directShareSnapshot = await directShareQuery.get();

      for (const doc of directShareSnapshot.docs) {
        const data = doc.data();
        const sharing = data.sharing;

        if (!sharing || !sharing.sharedWith) continue;

        // Check if shared directly with user
        const userShare = sharing.sharedWith.find(
          (s: any) => s.type === 'user' && s.targetId === callerUserId
        );

        if (userShare) {
          resources.push({
            resourceId: doc.id,
            resourceType: type,
            accessLevel: userShare.role,
            sharedBy: userShare.sharedBy,
            sharedAt: userShare.sharedAt,
          });
          continue;
        }

        // Check if shared with any of user's groups
        const groupShare = sharing.sharedWith.find(
          (s: any) => s.type === 'group' && userGroupIds.includes(s.targetId)
        );

        if (groupShare) {
          resources.push({
            resourceId: doc.id,
            resourceType: type,
            accessLevel: groupShare.role,
            sharedBy: groupShare.sharedBy,
            sharedAt: groupShare.sharedAt,
          });
        }
      }

      // Optionally include owned resources
      if (includeOwned) {
        const ownedQuery = db.collection(collectionName)
          .where('userId', '==', callerUserId)
          .where('isActive', '==', true);

        const ownedSnapshot = await ownedQuery.get();

        for (const doc of ownedSnapshot.docs) {
          const data = doc.data();
          // Don't duplicate if already added via sharing
          if (!resources.find(r => r.resourceId === doc.id && r.resourceType === type)) {
            resources.push({
              resourceId: doc.id,
              resourceType: type,
              accessLevel: ResourceRole.OWNER,
              sharedBy: callerUserId,
              sharedAt: data.createdAt,
            });
          }
        }
      }
    }

    console.log(`[getUserSharedResources] Found ${resources.length} resources`);

    return {
      success: true,
      resources,
    };

  } catch (error: any) {
    console.error('[getUserSharedResources] Error:', error);

    if (error.code && error.message) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to get shared resources');
  }
});
