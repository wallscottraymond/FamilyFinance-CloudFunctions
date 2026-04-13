import { UpdateGroupMemberRoleRequest, UpdateGroupMemberRoleResponse } from "../../../../types";
/**
 * Update a member's role within a group
 *
 * Only group owners can promote/demote to admin.
 * Admins can promote/demote editors and viewers.
 * Cannot change owner's role (use transferOwnership instead).
 */
export declare const updateGroupMemberRole: import("firebase-functions/v2/https").CallableFunction<UpdateGroupMemberRoleRequest, Promise<UpdateGroupMemberRoleResponse>>;
//# sourceMappingURL=updateGroupMemberRole.d.ts.map