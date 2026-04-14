import { ShareResourceRequest, ShareResourceResponse } from "../../../../types";
/**
 * Share a resource with a user or group
 *
 * Only the resource owner can share resources.
 * When sharing with a group, adds the groupId to the resource's groupIds array.
 */
export declare const shareResource: import("firebase-functions/v2/https").CallableFunction<ShareResourceRequest, Promise<ShareResourceResponse>>;
//# sourceMappingURL=shareResource.d.ts.map