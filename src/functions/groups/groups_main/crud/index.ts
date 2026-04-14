/**
 * Group CRUD Operations (RBAC v2)
 *
 * Core group management functions using onCall pattern with groupIds[].
 * These replace the legacy sharing module (onRequest with familyId).
 *
 * Renamed to avoid conflicts with legacy sharing module:
 * - createGroupV2 (was createGroup)
 * - leaveGroupV2 (was leaveGroup)
 * - removeGroupMemberV2 (was removeGroupMember)
 */

// Group lifecycle - renamed to avoid conflicts with legacy sharing module
export { createGroup as createGroupV2 } from './createGroup';
export { deleteGroup as deleteGroupV2 } from './deleteGroup';

// Member management - some renamed to avoid conflicts
export { addGroupMember as addGroupMemberV2 } from './addGroupMember';
export { removeGroupMember as removeGroupMemberV2 } from './removeGroupMember';
export { updateGroupMemberRole as updateGroupMemberRoleV2 } from './updateGroupMemberRole';
export { leaveGroup as leaveGroupV2 } from './leaveGroup';

// Ownership
export { transferGroupOwnership } from './transferGroupOwnership';
