import { RemoveGroupMemberRequest, RemoveGroupMemberResponse } from "../../../../types";
/**
 * Remove a member from a group
 *
 * Only group owners and admins can remove members.
 * Admins cannot remove the owner or other admins.
 * The removed member's groupIds array is updated automatically.
 */
export declare const removeGroupMember: import("firebase-functions/v2/https").CallableFunction<RemoveGroupMemberRequest, Promise<RemoveGroupMemberResponse>, unknown>;
//# sourceMappingURL=removeGroupMember.d.ts.map