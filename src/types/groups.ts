import { Timestamp } from "firebase-admin/firestore";
import { BaseDocument } from "./index";

// =======================
// GROUP SYSTEM
// =======================

// Role within a specific group (not system-wide)
export enum GroupRole {
  OWNER = "owner",      // Created the group, full control
  ADMIN = "admin",      // Full control except owner removal & group deletion
  EDITOR = "editor",    // Can edit resources, cannot manage group members or rules
  VIEWER = "viewer"     // Can view and leave notes only
}

// Group member information
export interface GroupMember {
  userId: string;
  role: GroupRole;
  joinedAt: Timestamp;
  invitedBy: string;
  status: 'active' | 'invited' | 'suspended';
}

// Group membership tracking (embedded in User document)
export interface GroupMembership {
  groupId: string;
  role: GroupRole;
  joinedAt: Timestamp;
  invitedBy: string;
  status: 'active' | 'invited' | 'suspended';
}

// Group settings
export interface GroupSettings {
  allowMemberInvites: boolean;
  requireApprovalForSharing: boolean;
  defaultResourceRole: GroupRole;
  maxMembers: number;
}

// Group document
export interface Group extends BaseDocument {
  name: string;
  description?: string;
  createdBy: string;
  ownerId: string;
  members: GroupMember[];
  settings: GroupSettings;
  isActive: boolean;
}

// =======================
// GROUP API TYPES
// =======================

export interface CreateGroupRequest {
  name: string;
  description?: string;
  settings?: Partial<GroupSettings>;
}

export interface CreateGroupResponse {
  success: boolean;
  groupId?: string;
  message?: string;
}

export interface AddGroupMemberRequest {
  groupId: string;
  userId: string;
  role: GroupRole;
}

export interface AddGroupMemberResponse {
  success: boolean;
  message?: string;
}

export interface UpdateGroupMemberRoleRequest {
  groupId: string;
  userId: string;
  newRole: GroupRole;
}

export interface UpdateGroupMemberRoleResponse {
  success: boolean;
  message?: string;
}

export interface RemoveGroupMemberRequest {
  groupId: string;
  userId: string;
}

export interface RemoveGroupMemberResponse {
  success: boolean;
  message?: string;
}
