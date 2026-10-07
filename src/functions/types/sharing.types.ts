/**
 * Sharing Types (Account-Rooted-Sharing, Phase 1)
 *
 * People, connections, requests and groups. Domain shapes are snake_case;
 * repositories map them to the camelCase Firestore documents.
 *
 * @module types/sharing
 */

/** A connect code a user shows to someone they want to connect with (D24). */
export interface ConnectCode {
  user_id: string;
  code: string;
  expires_at_ms: number;
  /** uid → when that person entered THIS code (ms). Bounded: cleared on new code. */
  entries: Record<string, number>;
  /** Wrong codes this user has typed in a row. */
  failed_attempts: number;
  cooldown_until_ms: number;
}

export type ConnectionStatus = "connected" | "blocked";

/** Two people who entered each other's codes (D24). Doc id = pair id. */
export interface Connection {
  id: string;
  user_ids: [string, string];
  status: ConnectionStatus;
  connected_at_ms: number;
  blocked_by: string | null;
  /** viewer uid → the name that viewer gave the other person (D28). */
  nicknames: Record<string, string>;
}

export type RequestType = "join_group";
export type RequestStatus = "pending" | "accepted" | "declined" | "expired" | "cancelled";

/** An offer that needs the recipient's one-tap Accept (D25). */
export interface SharingRequest {
  id: string;
  type: RequestType;
  from_user_id: string;
  to_user_id: string;
  group_id: string;
  status: RequestStatus;
  created_at_ms: number;
  expires_at_ms: number;
  responded_at_ms: number | null;
}

export type GroupRole = "owner" | "full";

export interface GroupMember {
  role: GroupRole;
  joined_at_ms: number;
}

/** A group (v1 roles: owner + full, PD4). */
export interface Group {
  id: string;
  name: string;
  owner_id: string;
  members: Record<string, GroupMember>;
  member_ids: string[];
  created_at_ms: number;
  deleted_at_ms: number | null;
}

/** A change to one user's `groupIds` list. */
export interface UserGroupChange {
  user_id: string;
  add?: string;
  remove?: string;
}

/** Everything a membership change writes, computed purely then applied atomically. */
export interface GroupMutation {
  group: Group;
  user_changes: UserGroupChange[];
}

/** A report of another person (D27). */
export interface PersonReport {
  id: string;
  reporter_id: string;
  reported_id: string;
  reason: string;
  created_at_ms: number;
}

/** How a person is shown to a viewer (D28): never an email or real name. */
export interface PersonView {
  user_id: string;
  generated_name: string;
  nickname: string | null;
}
