import { GetUserSharedResourcesRequest, GetUserSharedResourcesResponse } from "../../../../types";
/**
 * Get all resources shared with the current user
 *
 * Returns resources that are:
 * 1. Directly shared with the user
 * 2. Shared with groups the user is a member of
 * 3. Optionally, owned by the user
 */
export declare const getUserSharedResources: import("firebase-functions/v2/https").CallableFunction<GetUserSharedResourcesRequest, Promise<GetUserSharedResourcesResponse>, unknown>;
//# sourceMappingURL=getUserSharedResources.d.ts.map