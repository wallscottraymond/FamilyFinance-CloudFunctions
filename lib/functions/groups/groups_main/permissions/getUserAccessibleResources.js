"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserAccessibleResources = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
// Map resource types to collection names
const RESOURCE_COLLECTIONS = {
    budget: 'budgets',
    transaction: 'transactions',
    outflow: 'outflows',
    inflow: 'inflows',
    rule: 'rules',
};
const ALL_RESOURCE_TYPES = ['budget', 'transaction', 'outflow', 'inflow', 'rule'];
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
exports.getUserAccessibleResources = (0, https_1.onCall)({
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 60,
}, async (request) => {
    console.log('[getUserAccessibleResources] Function called with data:', JSON.stringify(request.data, null, 2));
    try {
        // Check authentication
        if (!request.auth) {
            throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
        }
        const callerUserId = request.auth.uid;
        const { resourceType, minAccessLevel } = request.data || {};
        // Get the user's group memberships
        const user = await (0, firestore_1.getDocument)('users', callerUserId);
        const userGroupIds = (user === null || user === void 0 ? void 0 : user.groupIds) || [];
        // Determine which resource types to query
        const typesToQuery = resourceType ? [resourceType] : ALL_RESOURCE_TYPES;
        const resources = [];
        const seenResourceIds = new Set();
        const db = admin.firestore();
        // Role hierarchy for filtering
        const roleHierarchy = {
            [types_1.ResourceRole.OWNER]: 3,
            [types_1.ResourceRole.EDITOR]: 2,
            [types_1.ResourceRole.VIEWER]: 1,
        };
        const minRoleLevel = minAccessLevel ? roleHierarchy[minAccessLevel] : 0;
        for (const type of typesToQuery) {
            const collectionName = RESOURCE_COLLECTIONS[type];
            if (!collectionName)
                continue;
            // Query for owned resources
            const ownedQuery = db.collection(collectionName)
                .where('userId', '==', callerUserId)
                .where('isActive', '==', true);
            const ownedSnapshot = await ownedQuery.get();
            for (const doc of ownedSnapshot.docs) {
                const resourceKey = `${type}-${doc.id}`;
                if (seenResourceIds.has(resourceKey))
                    continue;
                if (roleHierarchy[types_1.ResourceRole.OWNER] >= minRoleLevel) {
                    seenResourceIds.add(resourceKey);
                    resources.push({
                        resourceId: doc.id,
                        resourceType: type,
                        accessLevel: types_1.ResourceRole.OWNER,
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
                        if (seenResourceIds.has(resourceKey))
                            continue;
                        const data = doc.data();
                        const sharing = data.sharing;
                        if (!sharing || !sharing.sharedWith)
                            continue;
                        // Find the highest access level from group shares
                        let highestRole = null;
                        let matchedGroupId;
                        for (const share of sharing.sharedWith) {
                            if (share.type === 'group' && userGroupIds.includes(share.targetId)) {
                                const shareRole = share.role;
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
                if (seenResourceIds.has(resourceKey))
                    continue;
                const data = doc.data();
                const sharing = data.sharing;
                if (!sharing || !sharing.sharedWith)
                    continue;
                // Check for direct user share
                const userShare = sharing.sharedWith.find((s) => s.type === 'user' && s.targetId === callerUserId);
                if (userShare) {
                    const shareRole = userShare.role;
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
    }
    catch (error) {
        console.error('[getUserAccessibleResources] Error:', error);
        if (error.code && error.message) {
            throw error;
        }
        throw new https_1.HttpsError('internal', 'Failed to get accessible resources');
    }
});
//# sourceMappingURL=getUserAccessibleResources.js.map