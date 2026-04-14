import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
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

interface GetUserAccessibleResourcesRequest {
  resourceType?: 'budget' | 'transaction' | 'outflow' | 'inflow' | 'rule';
  minAccessLevel?: ResourceRole;
}

interface AccessibleResource {
  resourceId: string;
  resourceType: string;
  accessLevel: ResourceRole;
  accessSource: 'owner' | 'direct' | 'group';
  groupId?: string;
}

interface GetUserAccessibleResourcesResponse {
  success: boolean;
  resources?: AccessibleResource[];
  message?: string;
}

/**
 * Get all resources a user can access
 *
 * Returns all resources the user can access based on:
 * 1. Ownership
 * 2. Direct shares
 * 3. Group membership shares
 *
 * Optionally filters by resource type and minimum access level.
 */
export const getUserAccessibleResources = onCall<GetUserAccessibleResourcesRequest, Promise<GetUserAccessibleResourcesResponse>>({
  region: "us-central1",
  memory: "512MiB",
  timeoutSeconds: 60,
}, async (request) => {
  console.log('[getUserAccessibleResources] Function called with data:', JSON.stringify(request.data, null, 2));

  try {
    // Check authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const callerUserId = request.auth.uid;
    const { resourceType, minAccessLevel } = request.data || {};

    // Get the user's group memberships
    const user = await getDocument<User>('users', callerUserId);
    const userGroupIds: string[] = user?.groupIds || [];

    // Determine which resource types to query
    const typesToQuery = resourceType ? [resourceType] : ALL_RESOURCE_TYPES;

    const resources: AccessibleResource[] = [];
    const seenResourceIds = new Set<string>();

    const db = admin.firestore();

    // Role hierarchy for filtering
    const roleHierarchy: Record<ResourceRole, number> = {
      [ResourceRole.OWNER]: 3,
      [ResourceRole.EDITOR]: 2,
      [ResourceRole.VIEWER]: 1,
    };

    const minRoleLevel = minAccessLevel ? roleHierarchy[minAccessLevel] : 0;

    for (const type of typesToQuery) {
      const collectionName = RESOURCE_COLLECTIONS[type];
      if (!collectionName) continue;

      // Query for owned resources
      const ownedQuery = db.collection(collectionName)
        .where('userId', '==', callerUserId)
        .where('isActive', '==', true);

      const ownedSnapshot = await ownedQuery.get();

      for (const doc of ownedSnapshot.docs) {
        const resourceKey = `${type}-${doc.id}`;
        if (seenResourceIds.has(resourceKey)) continue;

        if (roleHierarchy[ResourceRole.OWNER] >= minRoleLevel) {
          seenResourceIds.add(resourceKey);
          resources.push({
            resourceId: doc.id,
            resourceType: type,
            accessLevel: ResourceRole.OWNER,
            accessSource: 'owner',
          });
        }
      }

      // Query for resources shared via groupIds (efficient query using array-contains-any)
      if (userGroupIds.length > 0) {
        // Firestore limits array-contains-any to 10 values
        const groupIdChunks = [];
        for (let i = 0; i < userGroupIds.length; i += 10) {
          groupIdChunks.push(userGroupIds.slice(i, i + 10));
        }

        for (const groupIdChunk of groupIdChunks) {
          const groupShareQuery = db.collection(collectionName)
            .where('groupIds', 'array-contains-any', groupIdChunk)
            .where('isActive', '==', true);

          const groupShareSnapshot = await groupShareQuery.get();

          for (const doc of groupShareSnapshot.docs) {
            const resourceKey = `${type}-${doc.id}`;
            if (seenResourceIds.has(resourceKey)) continue;

            const data = doc.data();
            const sharing = data.sharing;

            if (!sharing || !sharing.sharedWith) continue;

            // Find the highest access level from group shares
            let highestRole: ResourceRole | null = null;
            let matchedGroupId: string | undefined;

            for (const share of sharing.sharedWith) {
              if (share.type === 'group' && userGroupIds.includes(share.targetId)) {
                const shareRole = share.role as ResourceRole;
                if (!highestRole || roleHierarchy[shareRole] > roleHierarchy[highestRole]) {
                  highestRole = shareRole;
                  matchedGroupId = share.targetId;
                }
              }
            }

            if (highestRole && roleHierarchy[highestRole] >= minRoleLevel) {
              seenResourceIds.add(resourceKey);
              resources.push({
                resourceId: doc.id,
                resourceType: type,
                accessLevel: highestRole,
                accessSource: 'group',
                groupId: matchedGroupId,
              });
            }
          }
        }
      }

      // Query for resources directly shared with user
      const directShareQuery = db.collection(collectionName)
        .where('sharing.isShared', '==', true)
        .where('isActive', '==', true);

      const directShareSnapshot = await directShareQuery.get();

      for (const doc of directShareSnapshot.docs) {
        const resourceKey = `${type}-${doc.id}`;
        if (seenResourceIds.has(resourceKey)) continue;

        const data = doc.data();
        const sharing = data.sharing;

        if (!sharing || !sharing.sharedWith) continue;

        // Check for direct user share
        const userShare = sharing.sharedWith.find(
          (s: any) => s.type === 'user' && s.targetId === callerUserId
        );

        if (userShare) {
          const shareRole = userShare.role as ResourceRole;
          if (roleHierarchy[shareRole] >= minRoleLevel) {
            seenResourceIds.add(resourceKey);
            resources.push({
              resourceId: doc.id,
              resourceType: type,
              accessLevel: shareRole,
              accessSource: 'direct',
            });
          }
        }
      }
    }

    console.log(`[getUserAccessibleResources] Found ${resources.length} accessible resources`);

    return {
      success: true,
      resources,
    };

  } catch (error: any) {
    console.error('[getUserAccessibleResources] Error:', error);

    if (error.code && error.message) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to get accessible resources');
  }
});
