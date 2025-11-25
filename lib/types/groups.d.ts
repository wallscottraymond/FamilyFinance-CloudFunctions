import { Timestamp } from "firebase-admin/firestore";
import { BaseDocument } from "./index";
export declare enum GroupRole {
    OWNER = "owner",// Created the group, full control
    ADMIN = "admin",// Full control except owner removal & group deletion
    EDITOR = "editor",// Can edit resources, cannot manage group members or rules
    VIEWER = "viewer"
}
export interface GroupMember {
    userId: string;
    role: GroupRole;
    joinedAt: Timestamp;
    invitedBy: string;
    status: 'active' | 'invited' | 'suspended';
}
export interface GroupMembership {
    groupId: string;
    role: GroupRole;
    joinedAt: Timestamp;
    invitedBy: string;
    status: 'active' | 'invited' | 'suspended';
}
export interface GroupSettings {
    allowMemberInvites: boolean;
    requireApprovalForSharing: boolean;
    defaultResourceRole: GroupRole;
    maxMembers: number;
}
export interface Group extends BaseDocument {
    name: string;
    description?: string;
    createdBy: string;
    ownerId: string;
    members: GroupMember[];
    settings: GroupSettings;
    isActive: boolean;
}
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
//# sourceMappingURL=groups.d.ts.map