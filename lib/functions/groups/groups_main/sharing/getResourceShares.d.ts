import { ResourceShare } from "../../../../types";
interface GetResourceSharesRequest {
    resourceType: 'budget' | 'transaction' | 'outflow' | 'inflow' | 'rule';
    resourceId: string;
}
interface GetResourceSharesResponse {
    success: boolean;
    shares?: ResourceShare[];
    isShared?: boolean;
    message?: string;
}
/**
 * Get all shares for a specific resource
 *
 * Only the resource owner can view all shares.
 */
export declare const getResourceShares: import("firebase-functions/v2/https").CallableFunction<GetResourceSharesRequest, Promise<GetResourceSharesResponse>, unknown>;
export {};
//# sourceMappingURL=getResourceShares.d.ts.map