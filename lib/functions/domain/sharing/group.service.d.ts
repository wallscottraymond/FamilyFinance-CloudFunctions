/**
 * Groups (D4, D13, D30; v1 roles owner + full, PD4)
 *
 * Every membership change is computed here as a GroupMutation (the new group doc
 * plus each affected user's groupIds change); the repository applies it in one
 * transaction after re-reading, so limits can't be raced past.
 *
 * PURE: no IO; ids and time are passed in.
 *
 * @module domain/sharing/group
 */
import { Group, GroupMutation } from "../../types/sharing.types";
import { DomainResult } from "../../types";
export declare const MAX_GROUPS_PER_USER = 3;
export declare const MAX_MEMBERS_PER_GROUP = 50;
export declare const MAX_GROUP_NAME_LENGTH = 40;
/** Trimmed group name, or an error. */
export declare function validate_group_name(raw: string): {
    name: string;
    error?: string;
};
/** True when the user is a member of an active group. */
export declare function is_member(group: Group | null, user_id: string): boolean;
/** Owners and full members can add people and rename (PD4). */
export declare function can_manage_people(group: Group | null, user_id: string): boolean;
/** A new group with the creator as owner. */
export declare function build_group(id: string, raw_name: string, owner_id: string, owner_group_count: number, now_ms: number): DomainResult<GroupMutation>;
/**
 * Can `caller` invite `target`? Returns the errors (empty = yes). The caller must
 * be a member, the target must be connected with the caller (D24) and not
 * already in the group.
 */
export declare function validate_invite(group: Group | null, caller_id: string, target_id: string, target_connected: boolean): string[];
/** Adds someone who accepted a join request. */
export declare function accept_join(group: Group | null, user_id: string, user_group_count: number, now_ms: number): DomainResult<GroupMutation>;
/** Deletes a group: everyone loses it from their list (D13 effects run separately). */
export declare function delete_group(group: Group | null, caller_id: string, now_ms: number): DomainResult<GroupMutation>;
/**
 * Leaves a group. The owner must hand over first while others remain; an owner
 * who is the only member deletes the group by leaving.
 */
export declare function leave_group(group: Group | null, caller_id: string, now_ms: number): DomainResult<GroupMutation>;
/** The owner removes someone. */
export declare function remove_member(group: Group | null, caller_id: string, target_id: string): DomainResult<GroupMutation>;
/** The owner hands ownership to another member. */
export declare function transfer_ownership(group: Group | null, caller_id: string, target_id: string): DomainResult<GroupMutation>;
/** Any member renames the group. */
export declare function rename_group(group: Group | null, caller_id: string, raw_name: string): DomainResult<GroupMutation>;
//# sourceMappingURL=group.service.d.ts.map