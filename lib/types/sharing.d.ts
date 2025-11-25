import { Timestamp } from "firebase-admin/firestore";
export declare enum ResourceRole {
    OWNER = "owner",// Full control of the resource
    EDITOR = "editor",// Can edit the resource
    VIEWER = "viewer"
}
export interface ResourcePermissions {
    canEdit: boolean;
    canDelete: boolean;
    canReshare: boolean;
    canViewDetails: boolean;
}
export interface ResourceShare {
    type: 'group' | 'user';
    targetId: string;
    role: ResourceRole;
    sharedBy: string;
    sharedAt: Timestamp;
    permissions?: ResourcePermissions;
}
export interface ResourceSharing {
    isShared: boolean;
    sharedWith: ResourceShare[];
    inheritPermissions: boolean;
}
export interface SharedResource {
    createdBy: string;
    ownerId: string;
    sharing: ResourceSharing;
}
export interface ShareResourceRequest {
    resourceType: 'budget' | 'transaction' | 'outflow' | 'inflow' | 'rule';
    resourceId: string;
    shareWith: {
        type: 'group' | 'user';
        targetId: string;
        role: ResourceRole;
        permissions?: ResourcePermissions;
    };
}
export interface ShareResourceResponse {
    success: boolean;
    message?: string;
}
export interface UnshareResourceRequest {
    resourceType: 'budget' | 'transaction' | 'outflow' | 'inflow' | 'rule';
    resourceId: string;
    targetType: 'group' | 'user';
    targetId: string;
}
export interface UnshareResourceResponse {
    success: boolean;
    message?: string;
}
export interface UpdateSharePermissionsRequest {
    resourceType: 'budget' | 'transaction' | 'outflow' | 'inflow' | 'rule';
    resourceId: string;
    targetType: 'group' | 'user';
    targetId: string;
    newRole?: ResourceRole;
    newPermissions?: ResourcePermissions;
}
export interface UpdateSharePermissionsResponse {
    success: boolean;
    message?: string;
}
export interface GetUserSharedResourcesRequest {
    resourceType?: 'budget' | 'transaction' | 'outflow' | 'inflow' | 'rule';
    includeOwned?: boolean;
}
export interface GetUserSharedResourcesResponse {
    success: boolean;
    resources?: Array<{
        resourceId: string;
        resourceType: string;
        accessLevel: ResourceRole;
        sharedBy: string;
        sharedAt: Timestamp;
    }>;
    message?: string;
}
export interface CheckResourceAccessRequest {
    userId: string;
    resourceType: 'budget' | 'transaction' | 'outflow' | 'inflow' | 'rule';
    resourceId: string;
    requiredPermission: 'read' | 'edit' | 'delete' | 'share';
}
export interface CheckResourceAccessResponse {
    hasAccess: boolean;
    accessLevel?: ResourceRole;
    reason?: string;
}
//# sourceMappingURL=sharing.d.ts.map