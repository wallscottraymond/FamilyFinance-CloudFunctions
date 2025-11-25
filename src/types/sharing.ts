import { Timestamp } from "firebase-admin/firestore";

// =======================
// RESOURCE SHARING SYSTEM
// =======================

// Role for resource-level access (different from group role)
export enum ResourceRole {
  OWNER = "owner",      // Full control of the resource
  EDITOR = "editor",    // Can edit the resource
  VIEWER = "viewer"     // Can only view the resource
}

// Fine-grained permissions for a resource
export interface ResourcePermissions {
  canEdit: boolean;
  canDelete: boolean;
  canReshare: boolean;
  canViewDetails: boolean;
}

// Share information for a single target (user or group)
export interface ResourceShare {
  type: 'group' | 'user';
  targetId: string;              // Group ID or User ID
  role: ResourceRole;
  sharedBy: string;              // User ID who shared it
  sharedAt: Timestamp;
  permissions?: ResourcePermissions; // Optional fine-grained permissions
}

// Resource sharing configuration
export interface ResourceSharing {
  isShared: boolean;
  sharedWith: ResourceShare[];
  inheritPermissions: boolean;   // For nested resources (e.g., budget_periods inherit from budget)
}

// Base interface for all shareable resources
export interface SharedResource {
  createdBy: string;             // Original creator
  ownerId: string;               // Current owner
  sharing: ResourceSharing;      // Sharing configuration
}

// =======================
// SHARING API TYPES
// =======================

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

// =======================
// PERMISSION CHECKING UTILITIES
// =======================

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
