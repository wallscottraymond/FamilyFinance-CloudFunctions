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

import { TraceContext, PermissionDeniedError } from "../../types";
import { get_derive_version } from "../../repositories/derive_version.repo";
import { group_repo } from "../../repositories/sharing";
import { user_repo } from "../../repositories/user.repo";
import { is_member } from "../../domain/sharing/group.service";
import { group_view_key } from "../../domain/sharing/budget_view.service";
import {
  DeriveScopeRequest,
  group_view_version,
  me_view_version,
} from "../../domain/periods/derive_scope.service";

export interface ViewVersion {
  /** Cache owner key: the uid for Me, "group:<id>" for a group. */
  view_key: string;
  version: number;
}

/** The cache key for a view, known without any read: the uid for Me, "group:<id>" for a group. */
export function view_key_for(caller_id: string, request: DeriveScopeRequest | undefined): string {
  return request && request.kind === "group" ? group_view_key(request.group_id) : caller_id;
}

export async function resolve_view_version(
  ctx: TraceContext,
  caller_id: string,
  request: DeriveScopeRequest | undefined
): Promise<ViewVersion> {
  if (!request || request.kind === "me") {
    return { view_key: caller_id, version: await resolve_me_version(ctx, caller_id) };
  }
  const group = await group_repo.get(ctx, request.group_id);
  if (!is_member(group, caller_id)) {
    throw new PermissionDeniedError("view", `group ${request.group_id}`);
  }
  const key = group_view_key(request.group_id);
  const [group_version, ...versions] = await Promise.all([
    get_derive_version(key),
    ...group!.member_ids.map((m) => get_derive_version(m)),
  ]);
  const member_versions: Record<string, number> = {};
  group!.member_ids.forEach((m, i) => {
    member_versions[m] = versions[i];
  });
  return {
    view_key: key,
    version: group_view_version(group!.member_ids, group_version, member_versions),
  };
}

/**
 * The Me view's version. Same membership truth as `resolve_derive_scope`: users.groupIds
 * names the candidate groups, the group docs decide actual membership.
 */
async function resolve_me_version(ctx: TraceContext, caller_id: string): Promise<number> {
  const [own_version, user] = await Promise.all([
    get_derive_version(caller_id),
    user_repo.get_by_id(ctx, caller_id),
  ]);
  const group_ids = (user?.data.groupIds as string[] | undefined) ?? [];
  if (group_ids.length === 0) return own_version;
  const groups = (await group_repo.get_many(ctx, group_ids)).filter((g) =>
    is_member(g, caller_id)
  );
  const others = [
    ...new Set(groups.flatMap((g) => g.member_ids).filter((m) => m !== caller_id)),
  ];
  const versions = await Promise.all(others.map((m) => get_derive_version(m)));
  const member_versions: Record<string, number> = {};
  others.forEach((m, i) => {
    member_versions[m] = versions[i];
  });
  return me_view_version(
    own_version,
    groups.map((g) => ({ id: g.id, member_ids: g.member_ids })),
    member_versions
  );
}
