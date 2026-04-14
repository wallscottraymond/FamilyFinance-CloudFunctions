import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  ResourceShare,
  ResourceSharing,
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

interface GetResourceSharesRequest {
  resourceType: 'budget' | 'transaction' | 'outflow' | 'inflow' | 'rule';
  resourceId: string;
}

interface GetResourceSharesResponse {
  success: boolean;
  shares?: ResourceShare[];
  isShared?: boolean;
  message?: string;
}

/**
 * Get all shares for a specific resource
 *
 * Only the resource owner can view all shares.
 */
export const getResourceShares = onCall<GetResourceSharesRequest, Promise<GetResourceSharesResponse>>({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
}, async (request) => {
  console.log('[getResourceShares] Function called with data:', JSON.stringify(request.data, null, 2));

  try {
    // Check authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const callerUserId = request.auth.uid;
    const { resourceType, resourceId } = request.data;

    // Validate request data
    if (!resourceType || !RESOURCE_COLLECTIONS[resourceType]) {
      throw new HttpsError('invalid-argument', 'Valid resourceType is required');
    }

    if (!resourceId || typeof resourceId !== 'string') {
      throw new HttpsError('invalid-argument', 'resourceId is required');
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
      throw new HttpsError('permission-denied', 'Only the resource owner can view all shares');
    }

    // Get current sharing configuration
    const currentSharing: ResourceSharing = resource.sharing || {
      isShared: false,
      sharedWith: [],
      inheritPermissions: true,
    };

    console.log(`[getResourceShares] Found ${currentSharing.sharedWith.length} shares`);

    return {
      success: true,
      shares: currentSharing.sharedWith,
      isShared: currentSharing.isShared,
    };

  } catch (error: any) {
    console.error('[getResourceShares] Error:', error);

    if (error.code && error.message) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to get resource shares');
  }
});
