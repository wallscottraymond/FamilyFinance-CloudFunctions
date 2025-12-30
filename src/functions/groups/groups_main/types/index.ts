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

  // Ownership
  createdBy: string;           // User who created the group
  ownerId: string;             // Current owner (transferable)

  // Members
  memberIds: string[];         // Array of user IDs
  memberCount: number;         // Denormalized count for queries

  // Settings
  settings: GroupSettings;

  // Metadata
  isActive: boolean;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

/**
 * Group Settings
 */
export interface GroupSettings {
  // Visibility
  isPublic: boolean;           // Can others discover this group?
  allowJoinRequests: boolean;  // Can users request to join?

  // Permissions
  defaultMemberRole: GroupMemberRole;

  // Sharing defaults
  autoShareNewResources: boolean;  // Auto-share new resources with group?

  // Notifications
  notifyOnNewMember: boolean;
  notifyOnResourceShare: boolean;
}

/**
 * Group Member Roles
 */
export enum GroupMemberRole {
  OWNER = 'owner',      // Full control
  ADMIN = 'admin',      // Can manage members and settings
  EDITOR = 'editor',    // Can edit shared resources
  VIEWER = 'viewer'     // Read-only access
}

/**
 * Group Member Document
 */
export interface GroupMember {
  groupId: string;
  userId: string;
  role: GroupMemberRole;

  // Metadata
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

  // Invitee
  email: string;
  userId?: string;             // If user already exists

  // Invitation details
  invitedBy: string;
  invitedByName: string;
  role: GroupMemberRole;

  // Status
  status: InvitationStatus;
  expiresAt: FirebaseFirestore.Timestamp;

  // Metadata
  createdAt: FirebaseFirestore.Timestamp;
  acceptedAt?: FirebaseFirestore.Timestamp;
  declinedAt?: FirebaseFirestore.Timestamp;
}

/**
 * Invitation Status
 */
export enum InvitationStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled'
}
