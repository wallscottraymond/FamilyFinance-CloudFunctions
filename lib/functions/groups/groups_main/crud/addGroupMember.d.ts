import { AddGroupMemberRequest, AddGroupMemberResponse } from "../../../../types";
/**
 * Add a member to a group
 *
 * Only group owners and admins can add members.
 * The new member's groupIds array is updated automatically.
 */
export declare const addGroupMember: import("firebase-functions/v2/https").CallableFunction<AddGroupMemberRequest, Promise<AddGroupMemberResponse>, unknown>;
//# sourceMappingURL=addGroupMember.d.ts.map