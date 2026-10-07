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
import { transaction_repo } from "../../repositories/transaction.repo";
import { user_repo } from "../../repositories/user.repo";
import { group_repo } from "../../repositories/sharing";
import { is_member } from "../../domain/sharing/group.service";
import {
  DeriveScope,
  DeriveScopeRequest,
  build_me_scope,
  build_group_scope,
} from "../../domain/periods/derive_scope.service";

/**
 * Pairing-only transactions (D12): for Me, the user's groups' shared accounts owned by other
 * members, so a transfer into a group account is recognized as one. Never counted. Empty when
 * the scope has nothing extra (always, for a user in no groups).
 */
export async function load_pairing_extra_txns(
  ctx: TraceContext,
  scope: DeriveScope,
  start_ms: number,
  end_ms: number
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const extra = scope.pairing_extra;
  if (!extra) return [];
  const lists = await Promise.all(
    extra.member_ids.map((m) => transaction_repo.get_active_in_date_range(ctx, m, start_ms, end_ms))
  );
  return lists
    .flat()
    .filter((t) => extra.account_ids.has((t.data.accountId as string) ?? ""));
}

export async function resolve_derive_scope(
  ctx: TraceContext,
  caller_id: string,
  request: DeriveScopeRequest | undefined
): Promise<DeriveScope> {
  if (!request || request.kind === "me") {
    // Someone in no groups can't have shared accounts: skip the accounts read.
    const user = await user_repo.get_by_id(ctx, caller_id);
    const group_ids = (user?.data.groupIds as string[] | undefined) ?? [];
    if (group_ids.length === 0) return build_me_scope(caller_id, []);
    // The GROUP docs are the membership truth (users.groupIds is a mirror): an account leaves
    // Me only for a group the user is actually a member of — exactly the groups whose view
    // counts it (that view also requires its owner to be a member). Any stale placement
    // counts back in Me, so money can't fall between the two.
    const [accounts, groups] = await Promise.all([
      account_repo.get_by_user_id(ctx, caller_id),
      group_repo.get_many(ctx, group_ids),
    ]);
    const my_groups = groups.filter((g) => is_member(g, caller_id));
    const member_of = new Set(my_groups.map((g) => g.id));
    // Accounts of the user's groups (for transfer pairing only, D12): each group's shared
    // accounts whose owner is a member.
    const groups_accounts = (
      await Promise.all(my_groups.map((g) => account_repo.get_shared_with_group(ctx, g.id)))
    )
      .flatMap((list, i) =>
        list.filter((a) => my_groups[i].member_ids.includes(a.user_id))
      )
      .map((a) => ({
        doc_id: a.id,
        plaid_account_id: a.account_id || null,
        owner_id: a.user_id,
        shared_from_ms: a.placement?.shared_from_ms ?? null,
      }));
    return build_me_scope(
      caller_id,
      accounts
        .filter((a) => !!a.placement && member_of.has(a.placement.group_id))
        .map((a) => ({
          doc_id: a.id,
          plaid_account_id: a.account_id || null,
          shared_from_ms: a.placement?.shared_from_ms ?? null,
        })),
      groups_accounts
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
