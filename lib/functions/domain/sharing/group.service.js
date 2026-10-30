"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_GROUP_NAME_LENGTH = exports.MAX_MEMBERS_PER_GROUP = exports.MAX_GROUPS_PER_USER = void 0;
exports.validate_group_name = validate_group_name;
exports.is_member = is_member;
exports.can_manage_people = can_manage_people;
exports.build_group = build_group;
exports.validate_invite = validate_invite;
exports.accept_join = accept_join;
exports.delete_group = delete_group;
exports.leave_group = leave_group;
exports.remove_member = remove_member;
exports.transfer_ownership = transfer_ownership;
exports.rename_group = rename_group;
const types_1 = require("../../types");
exports.MAX_GROUPS_PER_USER = 3;
exports.MAX_MEMBERS_PER_GROUP = 50;
exports.MAX_GROUP_NAME_LENGTH = 40;
const LIMIT_MESSAGE = `You can be in up to ${exports.MAX_GROUPS_PER_USER} groups. Leave one to create or join another.`;
/** Trimmed group name, or an error. */
function validate_group_name(raw) {
    const name = raw.trim().replace(/\s+/g, " ");
    if (name.length === 0)
        return { name, error: "Give the group a name" };
    if (name.length > exports.MAX_GROUP_NAME_LENGTH) {
        return { name, error: `Group names can be up to ${exports.MAX_GROUP_NAME_LENGTH} characters` };
    }
    return { name };
}
function is_active(group) {
    return !!group && group.deleted_at_ms === null;
}
/** True when the user is a member of an active group. */
function is_member(group, user_id) {
    return is_active(group) && !!group.members[user_id];
}
/** Owners and full members can add people and rename (PD4). */
function can_manage_people(group, user_id) {
    return is_member(group, user_id);
}
/** A new group with the creator as owner. */
function build_group(id, raw_name, owner_id, owner_group_count, now_ms) {
    const { name, error } = validate_group_name(raw_name);
    if (error)
        return (0, types_1.validation_failed)([error]);
    if (owner_group_count >= exports.MAX_GROUPS_PER_USER)
        return (0, types_1.validation_failed)([LIMIT_MESSAGE]);
    return (0, types_1.success)({
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
function validate_invite(group, caller_id, target_id, target_connected) {
    if (!can_manage_people(group, caller_id))
        return ["You're not in this group"];
    if (target_id === caller_id)
        return ["You're already in this group"];
    if (!target_connected)
        return ["You can only add people you're connected with"];
    if (group.members[target_id])
        return ["They're already in this group"];
    if (group.member_ids.length >= exports.MAX_MEMBERS_PER_GROUP)
        return ["This group is full"];
    return [];
}
/** Adds someone who accepted a join request. */
function accept_join(group, user_id, user_group_count, now_ms) {
    if (!is_active(group))
        return (0, types_1.validation_failed)(["This group no longer exists"]);
    if (group.members[user_id])
        return (0, types_1.validation_failed)(["You're already in this group"]);
    if (group.member_ids.length >= exports.MAX_MEMBERS_PER_GROUP) {
        return (0, types_1.validation_failed)(["This group is full"]);
    }
    if (user_group_count >= exports.MAX_GROUPS_PER_USER)
        return (0, types_1.validation_failed)([LIMIT_MESSAGE]);
    return (0, types_1.success)({
        group: Object.assign(Object.assign({}, group), { members: Object.assign(Object.assign({}, group.members), { [user_id]: { role: "full", joined_at_ms: now_ms } }), member_ids: [...group.member_ids, user_id] }),
        user_changes: [{ user_id, add: group.id }],
    });
}
function without_member(group, user_id) {
    const members = Object.assign({}, group.members);
    delete members[user_id];
    return Object.assign(Object.assign({}, group), { members, member_ids: group.member_ids.filter((m) => m !== user_id) });
}
/** Deletes a group: everyone loses it from their list (D13 effects run separately). */
function delete_group(group, caller_id, now_ms) {
    if (!is_active(group))
        return (0, types_1.validation_failed)(["This group no longer exists"]);
    if (group.owner_id !== caller_id) {
        return (0, types_1.validation_failed)(["Only the owner can delete the group"]);
    }
    return (0, types_1.success)({
        group: Object.assign(Object.assign({}, group), { deleted_at_ms: now_ms }),
        user_changes: group.member_ids.map((uid) => ({ user_id: uid, remove: group.id })),
    });
}
/**
 * Leaves a group. The owner must hand over first while others remain; an owner
 * who is the only member deletes the group by leaving.
 */
function leave_group(group, caller_id, now_ms) {
    if (!is_member(group, caller_id))
        return (0, types_1.validation_failed)(["You're not in this group"]);
    if (group.owner_id === caller_id) {
        if (group.member_ids.length > 1) {
            return (0, types_1.validation_failed)(["Hand over ownership before you leave"]);
        }
        return delete_group(group, caller_id, now_ms);
    }
    return (0, types_1.success)({
        group: without_member(group, caller_id),
        user_changes: [{ user_id: caller_id, remove: group.id }],
    });
}
/** The owner removes someone. */
function remove_member(group, caller_id, target_id) {
    if (!is_active(group))
        return (0, types_1.validation_failed)(["This group no longer exists"]);
    if (group.owner_id !== caller_id)
        return (0, types_1.validation_failed)(["Only the owner can remove people"]);
    if (target_id === caller_id)
        return (0, types_1.validation_failed)(["Leave the group instead"]);
    if (!group.members[target_id])
        return (0, types_1.validation_failed)(["They're not in this group"]);
    return (0, types_1.success)({
        group: without_member(group, target_id),
        user_changes: [{ user_id: target_id, remove: group.id }],
    });
}
/** The owner hands ownership to another member. */
function transfer_ownership(group, caller_id, target_id) {
    if (!is_active(group))
        return (0, types_1.validation_failed)(["This group no longer exists"]);
    if (group.owner_id !== caller_id) {
        return (0, types_1.validation_failed)(["Only the owner can hand over ownership"]);
    }
    if (target_id === caller_id)
        return (0, types_1.validation_failed)(["You already own this group"]);
    const target = group.members[target_id];
    if (!target)
        return (0, types_1.validation_failed)(["They're not in this group"]);
    const members = Object.assign(Object.assign({}, group.members), { [caller_id]: Object.assign(Object.assign({}, group.members[caller_id]), { role: "full" }), [target_id]: Object.assign(Object.assign({}, target), { role: "owner" }) });
    return (0, types_1.success)({ group: Object.assign(Object.assign({}, group), { owner_id: target_id, members }), user_changes: [] });
}
/** Any member renames the group. */
function rename_group(group, caller_id, raw_name) {
    if (!can_manage_people(group, caller_id))
        return (0, types_1.validation_failed)(["You're not in this group"]);
    const { name, error } = validate_group_name(raw_name);
    if (error)
        return (0, types_1.validation_failed)([error]);
    return (0, types_1.success)({ group: Object.assign(Object.assign({}, group), { name }), user_changes: [] });
}
//# sourceMappingURL=group.service.js.map