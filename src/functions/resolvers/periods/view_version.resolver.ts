/**
 * View Version Resolver (Account-Rooted-Sharing; derive caches)
 *
 * READ-ONLY. The cache key + version for a derive call:
 *   - Me: the user's own key + version — EXACTLY as before (placement changes bump the
 *     owner's version, so Me needs no extra reads).
 *   - Group: key "group:<id>" (one cache shared by every member) and a version fingerprint
 *     of the members, the group's own version and each member's version. Membership is
 *     checked here too, so a cache HIT can never serve someone who isn't a member.
 *
 * @module resolvers/periods/view_version
 */

import { TraceContext, PermissionDeniedError } from "../../types";
import { get_derive_version } from "../../repositories/derive_version.repo";
import { group_repo } from "../../repositories/sharing";
import { is_member } from "../../domain/sharing/group.service";
import { group_view_key } from "../../domain/sharing/budget_view.service";
import {
  DeriveScopeRequest,
  group_view_version,
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
    return { view_key: caller_id, version: await get_derive_version(caller_id) };
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
