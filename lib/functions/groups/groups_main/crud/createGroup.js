"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGroup = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../../types");
const firestore_2 = require("../../../../utils/firestore");
// Default group settings
const DEFAULT_GROUP_SETTINGS = {
    allowMemberInvites: false,
    requireApprovalForSharing: false,
    defaultResourceRole: types_1.GroupRole.VIEWER,
    maxMembers: 50,
};
/**
 * Create a new group
 *
 * The user creating the group becomes the owner.
 * Group ID is added to the user's groupIds array.
 */
exports.createGroup = (0, https_1.onCall)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
}, async (request) => {
    console.log('🚀 [createGroup] Function called with data:', JSON.stringify(request.data, null, 2));
    try {
        // Check authentication
        if (!request.auth) {
            throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
        }
        const userId = request.auth.uid;
        // Get user document to verify they exist and check system role
        const userDoc = await (0, firestore_2.getDocument)('users', userId);
        if (!userDoc) {
            throw new https_1.HttpsError('not-found', 'User profile not found');
        }
        // Check if user is a demo user (cannot create groups)
        if (userDoc.systemRole === 'demo_user') {
            throw new https_1.HttpsError('permission-denied', 'Demo users cannot create groups');
        }
        // Validate request data
        const { name, description, settings } = request.data;
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            throw new https_1.HttpsError('invalid-argument', 'Group name is required');
        }
        if (name.length > 100) {
            throw new https_1.HttpsError('invalid-argument', 'Group name must be 100 characters or less');
        }
        if (description && description.length > 500) {
            throw new https_1.HttpsError('invalid-argument', 'Description must be 500 characters or less');
        }
        // Build group settings (merge with defaults)
        const groupSettings = Object.assign(Object.assign({}, DEFAULT_GROUP_SETTINGS), settings);
        // Validate settings
        if (groupSettings.maxMembers < 2 || groupSettings.maxMembers > 100) {
            throw new https_1.HttpsError('invalid-argument', 'maxMembers must be between 2 and 100');
        }
        // Create the owner member entry
        const ownerMember = {
            userId,
            role: types_1.GroupRole.OWNER,
            joinedAt: firestore_1.Timestamp.now(),
            invitedBy: userId, // Owner invited themselves
            status: 'active',
        };
        // Build the group document
        const groupDoc = {
            name: name.trim(),
            description: description === null || description === void 0 ? void 0 : description.trim(),
            createdBy: userId,
            ownerId: userId,
            members: [ownerMember],
            settings: groupSettings,
            isActive: true,
        };
        // Create the group document
        const createdGroup = await (0, firestore_2.createDocument)("groups", groupDoc);
        console.log('✅ [createGroup] Group created:', createdGroup.id);
        // Add the group to the user's groupIds array and groupMemberships
        const userMembership = {
            groupId: createdGroup.id,
            role: types_1.GroupRole.OWNER,
            joinedAt: firestore_1.Timestamp.now(),
            invitedBy: userId,
            status: 'active',
        };
        await (0, firestore_2.updateDocument)('users', userId, {
            groupIds: firestore_1.FieldValue.arrayUnion(createdGroup.id),
            groupMemberships: firestore_1.FieldValue.arrayUnion(userMembership),
        });
        console.log('✅ [createGroup] User groupIds updated');
        return {
            success: true,
            groupId: createdGroup.id,
            message: 'Group created successfully',
        };
    }
    catch (error) {
        console.error('❌ [createGroup] Error:', error);
        if (error.code && error.message) {
            throw error;
        }
        throw new https_1.HttpsError('internal', 'Failed to create group');
    }
});
//# sourceMappingURL=createGroup.js.map