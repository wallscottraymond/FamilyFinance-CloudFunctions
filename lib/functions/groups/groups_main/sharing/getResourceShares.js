"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getResourceShares = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("../../../../utils/firestore");
// Map resource types to collection names
const RESOURCE_COLLECTIONS = {
    budget: 'budgets',
    transaction: 'transactions',
    outflow: 'outflows',
    inflow: 'inflows',
    rule: 'rules',
};
/**
 * Get all shares for a specific resource
 *
 * Only the resource owner can view all shares.
 */
exports.getResourceShares = (0, https_1.onCall)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
}, async (request) => {
    console.log('[getResourceShares] Function called with data:', JSON.stringify(request.data, null, 2));
    try {
        // Check authentication
        if (!request.auth) {
            throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
        }
        const callerUserId = request.auth.uid;
        const { resourceType, resourceId } = request.data;
        // Validate request data
        if (!resourceType || !RESOURCE_COLLECTIONS[resourceType]) {
            throw new https_1.HttpsError('invalid-argument', 'Valid resourceType is required');
        }
        if (!resourceId || typeof resourceId !== 'string') {
            throw new https_1.HttpsError('invalid-argument', 'resourceId is required');
        }
        const collectionName = RESOURCE_COLLECTIONS[resourceType];
        // Get the resource
        const resource = await (0, firestore_1.getDocument)(collectionName, resourceId);
        if (!resource) {
            throw new https_1.HttpsError('not-found', `${resourceType} not found`);
        }
        // Check if caller is the owner
        const ownerId = resource.ownerId || resource.userId || resource.createdBy;
        if (ownerId !== callerUserId) {
            throw new https_1.HttpsError('permission-denied', 'Only the resource owner can view all shares');
        }
        // Get current sharing configuration
        const currentSharing = resource.sharing || {
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
    }
    catch (error) {
        console.error('[getResourceShares] Error:', error);
        if (error.code && error.message) {
            throw error;
        }
        throw new https_1.HttpsError('internal', 'Failed to get resource shares');
    }
});
//# sourceMappingURL=getResourceShares.js.map