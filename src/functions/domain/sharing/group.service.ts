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
import { DomainResult, success, validation_failed } from "../../types";

export const MAX_GROUPS_PER_USER = 3;
export const MAX_MEMBERS_PER_GROUP = 50;
export const MAX_GROUP_NAME_LENGTH = 40;

const LIMIT_MESSAGE =
  `You can be in up to ${MAX_GROUPS_PER_USER} groups. Leave one to create or join another.`;

/** Trimmed group name, or an error. */
export function validate_group_name(raw: string): { name: string; error?: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length === 0) return { name, error: "Give the group a name" };
  if (name.length > MAX_GROUP_NAME_LENGTH) {
    return { name, error: `Group names can be up to ${MAX_GROUP_NAME_LENGTH} characters` };
  }
  return { name };
}

function is_active(group: Group | null): group is Group {
  return !!group && group.deleted_at_ms === null;
}

/** True when the user is a member of an active group. */
export function is_member(group: Group | null, user_id: string): boolean {
  return is_active(group) && !!group.members[user_id];
}

/** Owners and full members can add people and rename (PD4). */
export function can_manage_people(group: Group | null, user_id: string): boolean {
  return is_member(group, user_id);
}

/** A new group with the creator as owner. */
export function build_group(
  id: string,
  raw_name: string,
  owner_id: string,
  owner_group_count: number,
  now_ms: number
): DomainResult<GroupMutation> {
  const { name, error } = validate_group_name(raw_name);
  if (error) return validation_failed([error]);
  if (owner_group_count >= MAX_GROUPS_PER_USER) return validation_failed([LIMIT_MESSAGE]);
  return success({
    group: {
      id,
      name,
      owner_id,
      members: { [owner_id]: { role: "owner", joined_at_ms: now_ms } },
      member_ids: [owner_id],
      created_at_ms: now_ms,
      deleted_at_ms: null,
    },
    user_changes: [{ user_id: owner_id, add: id }],
  });
}

/**
 * Can `caller` invite `target`? Returns the errors (empty = yes). The caller must
 * be a member, the target must be connected with the caller (D24) and not
 * already in the group.
 */
export function validate_invite(
  group: Group | null,
  caller_id: string,
  target_id: string,
  target_connected: boolean
): string[] {
  if (!can_manage_people(group, caller_id)) return ["You're not in this group"];
  if (target_id === caller_id) return ["You're already in this group"];
  if (!target_connected) return ["You can only add people you're connected with"];
  if (group!.members[target_id]) return ["They're already in this group"];
  if (group!.member_ids.length >= MAX_MEMBERS_PER_GROUP) return ["This group is full"];
  return [];
}

/** Adds someone who accepted a join request. */
export function accept_join(
  group: Group | null,
  user_id: string,
  user_group_count: number,
  now_ms: number
): DomainResult<GroupMutation> {
  if (!is_active(group)) return validation_failed(["This group no longer exists"]);
  if (group.members[user_id]) return validation_failed(["You're already in this group"]);
  if (group.member_ids.length >= MAX_MEMBERS_PER_GROUP) {
    return validation_failed(["This group is full"]);
  }
  if (user_group_count >= MAX_GROUPS_PER_USER) return validation_failed([LIMIT_MESSAGE]);
  return success({
    group: {
      ...group,
      members: { ...group.members, [user_id]: { role: "full", joined_at_ms: now_ms } },
      member_ids: [...group.member_ids, user_id],
    },
    user_changes: [{ user_id, add: group.id }],
  });
}

function without_member(group: Group, user_id: string): Group {
  const members = { ...group.members };
  delete members[user_id];
  return { ...group, members, member_ids: group.member_ids.filter((m) => m !== user_id) };
}

/** Deletes a group: everyone loses it from their list (D13 effects run separately). */
export function delete_group(
  group: Group | null,
  caller_id: string,
  now_ms: number
): DomainResult<GroupMutation> {
  if (!is_active(group)) return validation_failed(["This group no longer exists"]);
  if (group.owner_id !== caller_id) {
    return validation_failed(["Only the owner can delete the group"]);
  }
  return success({
    group: { ...group, deleted_at_ms: now_ms },
    user_changes: group.member_ids.map((uid) => ({ user_id: uid, remove: group.id })),
  });
}

/**
 * Leaves a group. The owner must hand over first while others remain; an owner
 * who is the only member deletes the group by leaving.
 */
export function leave_group(
  group: Group | null,
  caller_id: string,
  now_ms: number
): DomainResult<GroupMutation> {
  if (!is_member(group, caller_id)) return validation_failed(["You're not in this group"]);
  if (group!.owner_id === caller_id) {
    if (group!.member_ids.length > 1) {
      return validation_failed(["Hand over ownership before you leave"]);
    }
    return delete_group(group, caller_id, now_ms);
  }
  return success({
    group: without_member(group!, caller_id),
    user_changes: [{ user_id: caller_id, remove: group!.id }],
  });
}

/** The owner removes someone. */
export function remove_member(
  group: Group | null,
  caller_id: string,
  target_id: string
): DomainResult<GroupMutation> {
  if (!is_active(group)) return validation_failed(["This group no longer exists"]);
  if (group.owner_id !== caller_id) return validation_failed(["Only the owner can remove people"]);
  if (target_id === caller_id) return validation_failed(["Leave the group instead"]);
  if (!group.members[target_id]) return validation_failed(["They're not in this group"]);
  return success({
    group: without_member(group, target_id),
    user_changes: [{ user_id: target_id, remove: group.id }],
  });
}

/** The owner hands ownership to another member. */
export function transfer_ownership(
  group: Group | null,
  caller_id: string,
  target_id: string
): DomainResult<GroupMutation> {
  if (!is_active(group)) return validation_failed(["This group no longer exists"]);
  if (group.owner_id !== caller_id) {
    return validation_failed(["Only the owner can hand over ownership"]);
  }
  if (target_id === caller_id) return validation_failed(["You already own this group"]);
  const target = group.members[target_id];
  if (!target) return validation_failed(["They're not in this group"]);
  const members = {
    ...group.members,
    [caller_id]: { ...group.members[caller_id], role: "full" as const },
    [target_id]: { ...target, role: "owner" as const },
  };
  return success({ group: { ...group, owner_id: target_id, members }, user_changes: [] });
}

/** Any member renames the group. */
export function rename_group(
  group: Group | null,
  caller_id: string,
  raw_name: string
): DomainResult<GroupMutation> {
  if (!can_manage_people(group, caller_id)) return validation_failed(["You're not in this group"]);
  const { name, error } = validate_group_name(raw_name);
  if (error) return validation_failed([error]);
  return success({ group: { ...group!, name }, user_changes: [] });
}
