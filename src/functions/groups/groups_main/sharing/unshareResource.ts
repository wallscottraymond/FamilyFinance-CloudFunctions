import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  UnshareResourceRequest,
  UnshareResourceResponse,
  ResourceSharing,
} from "../../../../types";
import {
  getDocument,
  updateDocument,
} from "../../../../utils/firestore";

// Map resource types to collection names
const RESOURCE_COLLECTIONS: Record<string, string> = {
  budget: 'budgets',
  transaction: 'transactions',
  outflow: 'outflows',
  inflow: 'inflows',
  rule: 'rules',
};

/**
 * Remove sharing from a resource
 *
 * Only the resource owner can unshare resources.
 * Removes the share entry and updates groupIds array if applicable.
 */
export const unshareResource = onCall<UnshareResourceRequest, Promise<UnshareResourceResponse>>({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
}, async (request) => {
  console.log('[unshareResource] Function called with data:', JSON.stringify(request.data, null, 2));

  try {
    // Check authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const callerUserId = request.auth.uid;
    const { resourceType, resourceId, targetType, targetId } = request.data;

    // Validate request data
    if (!resourceType || !RESOURCE_COLLECTIONS[resourceType]) {
      throw new HttpsError('invalid-argument', 'Valid resourceType is required');
    }

    if (!resourceId || typeof resourceId !== 'string') {
      throw new HttpsError('invalid-argument', 'resourceId is required');
    }

    if (!targetType || (targetType !== 'group' && targetType !== 'user')) {
      throw new HttpsError('invalid-argument', 'Valid targetType (group or user) is required');
    }

    if (!targetId || typeof targetId !== 'string') {
      throw new HttpsError('invalid-argument', 'targetId is required');
    }

    const collectionName = RESOURCE_COLLECTIONS[resourceType];

    // Get the resource
    const resource = await getDocument<any>(collectionName, resourceId);
    if (!resource) {
      throw new HttpsError('not-found', `${resourceType} not found`);
    }

    // Check if caller is the owner
    const ownerId = resource.ownerId || resource.userId || resource.createdBy;
    if (ownerId !== callerUserId) {
      throw new HttpsError('permission-denied', 'Only the resource owner can unshare resources');
    }

    // Get current sharing configuration
    const currentSharing: ResourceSharing = resource.sharing || {
      isShared: false,
      sharedWith: [],
      inheritPermissions: true,
    };

    // Find and remove the share entry
    const shareIndex = currentSharing.sharedWith.findIndex(
      s => s.type === targetType && s.targetId === targetId
    );

    if (shareIndex === -1) {
      throw new HttpsError('not-found', 'Share not found');
    }

    currentSharing.sharedWith.splice(shareIndex, 1);
    currentSharing.isShared = currentSharing.sharedWith.length > 0;

    // Build update object
    const updateData: any = {
      sharing: currentSharing,
    };

    // If unsharing from a group, also remove from groupIds array
    if (targetType === 'group') {
      const currentGroupIds: string[] = resource.groupIds || [];
      updateData.groupIds = currentGroupIds.filter(id => id !== targetId);
    }

    // Update the resource
    await updateDocument(collectionName, resourceId, updateData);

    console.log('[unshareResource] Resource unshared successfully');

    return {
      success: true,
      message: `${resourceType} unshared successfully`,
    };

  } catch (error: any) {
    console.error('[unshareResource] Error:', error);

    if (error.code && error.message) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to unshare resource');
  }
});
