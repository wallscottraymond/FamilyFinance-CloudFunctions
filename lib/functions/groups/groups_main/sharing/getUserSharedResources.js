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
exports.getUserSharedResources = void 0;
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
 * Get all resources shared with the current user
 *
 * Returns resources that are:
 * 1. Directly shared with the user
 * 2. Shared with groups the user is a member of
 * 3. Optionally, owned by the user
 */
exports.getUserSharedResources = (0, https_1.onCall)({
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 60,
}, async (request) => {
    console.log('[getUserSharedResources] Function called with data:', JSON.stringify(request.data, null, 2));
    try {
        // Check authentication
        if (!request.auth) {
            throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
        }
        const callerUserId = request.auth.uid;
        const { resourceType, includeOwned = false } = request.data || {};
        // Get the user's group memberships
        const user = await (0, firestore_1.getDocument)('users', callerUserId);
        const userGroupIds = (user === null || user === void 0 ? void 0 : user.groupIds) || [];
        // Determine which resource types to query
        const typesToQuery = resourceType ? [resourceType] : ALL_RESOURCE_TYPES;
        const resources = [];
        const db = admin.firestore();
        for (const type of typesToQuery) {
            const collectionName = RESOURCE_COLLECTIONS[type];
            if (!collectionName)
                continue;
            // Query for resources shared with user directly
            const directShareQuery = db.collection(collectionName)
                .where('sharing.isShared', '==', true)
                .where('isActive', '==', true);
            const directShareSnapshot = await directShareQuery.get();
            for (const doc of directShareSnapshot.docs) {
                const data = doc.data();
                const sharing = data.sharing;
                if (!sharing || !sharing.sharedWith)
                    continue;
                // Check if shared directly with user
                const userShare = sharing.sharedWith.find((s) => s.type === 'user' && s.targetId === callerUserId);
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
                const groupShare = sharing.sharedWith.find((s) => s.type === 'group' && userGroupIds.includes(s.targetId));
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
                            accessLevel: types_1.ResourceRole.OWNER,
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
    }
    catch (error) {
        console.error('[getUserSharedResources] Error:', error);
        if (error.code && error.message) {
            throw error;
        }
        throw new https_1.HttpsError('internal', 'Failed to get shared resources');
    }
});
//# sourceMappingURL=getUserSharedResources.js.map