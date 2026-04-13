import { CreateGroupRequest, CreateGroupResponse } from "../../../../types";
/**
 * Create a new group
 *
 * The user creating the group becomes the owner.
 * Group ID is added to the user's groupIds array.
 */
export declare const createGroup: import("firebase-functions/v2/https").CallableFunction<CreateGroupRequest, Promise<CreateGroupResponse>>;
//# sourceMappingURL=createGroup.d.ts.map