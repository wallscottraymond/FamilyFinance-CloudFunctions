/**
 * Groups Main Types
 *
 * Type definitions for core group functionality
 */
/**
 * Group Document Structure
 */
export interface Group {
    id: string;
    name: string;
    description?: string;
    createdBy: string;
    ownerId: string;
    memberIds: string[];
    memberCount: number;
    settings: GroupSettings;
    isActive: boolean;
    createdAt: FirebaseFirestore.Timestamp;
    updatedAt: FirebaseFirestore.Timestamp;
}
/**
 * Group Settings
 */
export interface GroupSettings {
    isPublic: boolean;
    allowJoinRequests: boolean;
    defaultMemberRole: GroupMemberRole;
    autoShareNewResources: boolean;
    notifyOnNewMember: boolean;
    notifyOnResourceShare: boolean;
}
/**
 * Group Member Roles
 */
export declare enum GroupMemberRole {
    OWNER = "owner",// Full control
    ADMIN = "admin",// Can manage members and settings
    EDITOR = "editor",// Can edit shared resources
    VIEWER = "viewer"
}
/**
 * Group Member Document
 */
export interface GroupMember {
    groupId: string;
    userId: string;
    role: GroupMemberRole;
    joinedAt: FirebaseFirestore.Timestamp;
    invitedBy?: string;
    lastActiveAt?: FirebaseFirestore.Timestamp;
}
/**
 * Group Invitation
 */
export interface GroupInvitation {
    id: string;
    groupId: string;
    groupName: string;
    email: string;
    userId?: string;
    invitedBy: string;
    invitedByName: string;
    role: GroupMemberRole;
    status: InvitationStatus;
    expiresAt: FirebaseFirestore.Timestamp;
    createdAt: FirebaseFirestore.Timestamp;
    acceptedAt?: FirebaseFirestore.Timestamp;
    declinedAt?: FirebaseFirestore.Timestamp;
}
/**
 * Invitation Status
 */
export declare enum InvitationStatus {
    PENDING = "pending",
    ACCEPTED = "accepted",
    DECLINED = "declined",
    EXPIRED = "expired",
    CANCELLED = "cancelled"
}
//# sourceMappingURL=index.d.ts.map