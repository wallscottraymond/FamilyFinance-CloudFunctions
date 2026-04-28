import { ResourceRole } from "../../../../types";
interface GetUserAccessibleResourcesRequest {
    resourceType?: 'budget' | 'transaction' | 'outflow' | 'inflow' | 'rule';
    minAccessLevel?: ResourceRole;
}
interface AccessibleResource {
    resourceId: string;
    resourceType: string;
    accessLevel: ResourceRole;
    accessSource: 'owner' | 'direct' | 'group';
    groupId?: string;
}
interface GetUserAccessibleResourcesResponse {
    success: boolean;
    resources?: AccessibleResource[];
    message?: string;
}
/**
 * Get all resources a user can access
 *
 * Returns all resources the user can access based on:
 * 1. Ownership
 * 2. Direct shares
 * 3. Group membership shares
 *
 * Optionally filters by resource type and minimum access level.
 */
export declare const getUserAccessibleResources: import("firebase-functions/v2/https").CallableFunction<GetUserAccessibleResourcesRequest, Promise<GetUserAccessibleResourcesResponse>, unknown>;
export {};
//# sourceMappingURL=getUserAccessibleResources.d.ts.map