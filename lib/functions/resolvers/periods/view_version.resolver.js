"use strict";
/**
 * View Version Resolver (Account-Rooted-Sharing; derive caches)
 *
 * READ-ONLY. The cache key + version for a derive call:
 *   - Me: the user's own key. Version = their own version when they're in no group (exactly
 *     as before). In a group, Me also pairs transfers against other members' transactions
 *     (D12), so the version fingerprints the groups, their members and each member's version
 *     (+1 user read, +1 per group, +1 per other member).
 *   - Group: key "group:<id>" (one cache shared by every member) and a version fingerprint
 *     of the members, the group's own version and each member's version. Membership is
 *     checked here too, so a cache HIT can never serve someone who isn't a member.
 *
 * @module resolvers/periods/view_version
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.view_key_for = view_key_for;
exports.resolve_view_version = resolve_view_version;
const types_1 = require("../../types");
const derive_version_repo_1 = require("../../repositories/derive_version.repo");
const sharing_1 = require("../../repositories/sharing");
const user_repo_1 = require("../../repositories/user.repo");
const group_service_1 = require("../../domain/sharing/group.service");
const budget_view_service_1 = require("../../domain/sharing/budget_view.service");
const derive_scope_service_1 = require("../../domain/periods/derive_scope.service");
/** The cache key for a view, known without any read: the uid for Me, "group:<id>" for a group. */
function view_key_for(caller_id, request) {
    return request && request.kind === "group" ? (0, budget_view_service_1.group_view_key)(request.group_id) : caller_id;
}
async function resolve_view_version(ctx, caller_id, request) {
    if (!request || request.kind === "me") {
        return { view_key: caller_id, version: await resolve_me_version(ctx, caller_id) };
    }
    const group = await sharing_1.group_repo.get(ctx, request.group_id);
    if (!(0, group_service_1.is_member)(group, caller_id)) {
        throw new types_1.PermissionDeniedError("view", `group ${request.group_id}`);
    }
    const key = (0, budget_view_service_1.group_view_key)(request.group_id);
    const [group_version, ...versions] = await Promise.all([
        (0, derive_version_repo_1.get_derive_version)(key),
        ...group.member_ids.map((m) => (0, derive_version_repo_1.get_derive_version)(m)),
    ]);
    const member_versions = {};
    group.member_ids.forEach((m, i) => {
        member_versions[m] = versions[i];
    });
    return {
        view_key: key,
        version: (0, derive_scope_service_1.group_view_version)(group.member_ids, group_version, member_versions),
    };
}
/**
 * The Me view's version. Same membership truth as `resolve_derive_scope`: users.groupIds
 * names the candidate groups, the group docs decide actual membership.
 */
async function resolve_me_version(ctx, caller_id) {
    var _a;
    const [own_version, user] = await Promise.all([
        (0, derive_version_repo_1.get_derive_version)(caller_id),
        user_repo_1.user_repo.get_by_id(ctx, caller_id),
    ]);
    const group_ids = (_a = user === null || user === void 0 ? void 0 : user.data.groupIds) !== null && _a !== void 0 ? _a : [];
    if (group_ids.length === 0)
        return own_version;
    const groups = (await sharing_1.group_repo.get_many(ctx, group_ids)).filter((g) => (0, group_service_1.is_member)(g, caller_id));
    const others = [
        ...new Set(groups.flatMap((g) => g.member_ids).filter((m) => m !== caller_id)),
    ];
    const versions = await Promise.all(others.map((m) => (0, derive_version_repo_1.get_derive_version)(m)));
    const member_versions = {};
    others.forEach((m, i) => {
        member_versions[m] = versions[i];
    });
    return (0, derive_scope_service_1.me_view_version)(own_version, groups.map((g) => ({ id: g.id, member_ids: g.member_ids })), member_versions);
}
//# sourceMappingURL=view_version.resolver.js.map