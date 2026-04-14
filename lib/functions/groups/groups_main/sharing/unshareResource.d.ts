import { UnshareResourceRequest, UnshareResourceResponse } from "../../../../types";
/**
 * Remove sharing from a resource
 *
 * Only the resource owner can unshare resources.
 * Removes the share entry and updates groupIds array if applicable.
 */
export declare const unshareResource: import("firebase-functions/v2/https").CallableFunction<UnshareResourceRequest, Promise<UnshareResourceResponse>>;
//# sourceMappingURL=unshareResource.d.ts.map