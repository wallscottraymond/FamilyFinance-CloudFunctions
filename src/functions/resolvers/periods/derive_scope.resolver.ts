/**
 * Derive Scope Resolver (Account-Rooted-Sharing D2; Rules §4.1–4.2)
 *
 * READ-ONLY. Turns a scope request into a resolved scope, server-side. Never
 * trusts a client-sent account list: the account set comes from placements.
 *   - Me: the caller's ACTIVE accounts that are shared are excluded (an inactive
 *     shared account counts nowhere in a group, so its kept history stays in Me).
 *   - Group: the caller must be a member (else PermissionDeniedError); the view
 *     is the group's active shared accounts whose owner is still a member.
 *
 * @module resolvers/periods/derive_scope
 */

import { TraceContext, PermissionDeniedError } from "../../types";
import { account_repo } from "../../repositories/account.repo";
import { group_repo } from "../../repositories/sharing";
import { is_member } from "../../domain/sharing/group.service";
import {
  DeriveScope,
  DeriveScopeRequest,
  build_me_scope,
  build_group_scope,
} from "../../domain/periods/derive_scope.service";

export async function resolve_derive_scope(
  ctx: TraceContext,
  caller_id: string,
  request: DeriveScopeRequest | undefined
): Promise<DeriveScope> {
  if (!request || request.kind === "me") {
    const accounts = await account_repo.get_by_user_id(ctx, caller_id);
    return build_me_scope(
      caller_id,
      accounts
        .filter((a) => !!a.placement)
        .map((a) => ({ doc_id: a.id, plaid_account_id: a.account_id || null }))
    );
  }
  const group = await group_repo.get(ctx, request.group_id);
  if (!is_member(group, caller_id)) {
    throw new PermissionDeniedError("view", `group ${request.group_id}`);
  }
  const shared = await account_repo.get_shared_with_group(ctx, request.group_id);
  return build_group_scope(
    request.group_id,
    group!.member_ids,
    shared.map((a) => ({
      doc_id: a.id,
      plaid_account_id: a.account_id || null,
      owner_id: a.user_id,
      shared_from_ms: a.placement?.shared_from_ms ?? null,
    }))
  );
}
