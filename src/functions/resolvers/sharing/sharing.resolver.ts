/**
 * Sharing Resolvers (Account-Rooted-Sharing Phase 1)
 *
 * READ-ONLY. Each resolver loads exactly what one sharing operation's domain
 * rule needs. No decisions here: lookups only.
 *
 * @module resolvers/sharing/sharing
 */

import { TraceContext } from "../../types";
import {
  ConnectCode,
  Connection,
  Group,
  SharingRequest,
} from "../../types/sharing.types";
import {
  connect_code_repo,
  connection_repo,
  group_repo,
  request_repo,
} from "../../repositories/sharing";
import { pair_id } from "../../domain/sharing/connection.service";
import { DAY_MS } from "../../domain/sharing/request.service";
import { PlaceableAccount } from "../../domain/sharing/placement.service";
import { account_repo, Account } from "../../repositories/account.repo";

/** For get_my_connect_code. */
export async function resolve_my_code(
  ctx: TraceContext,
  user_id: string
): Promise<{ existing: ConnectCode | null; connection_count: number }> {
  const [existing, connection_count] = await Promise.all([
    connect_code_repo.get_by_user(ctx, user_id),
    connection_repo.count_connected(ctx, user_id),
  ]);
  return { existing, connection_count };
}

/** Whether a freshly generated code is already in use by someone else. */
export async function resolve_code_taken(
  ctx: TraceContext,
  code: string,
  user_id: string,
  now_ms: number
): Promise<boolean> {
  const matches = await connect_code_repo.find_active_by_code(ctx, code, now_ms);
  return matches.some((m) => m.user_id !== user_id);
}

export interface CodeEntryDeps {
  caller_code: ConnectCode | null;
  /** The single active code doc matching what was typed (null if 0 or ambiguous). */
  target: ConnectCode | null;
  existing_connection: Connection | null;
  caller_connection_count: number;
  target_connection_count: number;
}

/** For enter_connect_code. */
export async function resolve_code_entry(
  ctx: TraceContext,
  user_id: string,
  code: string,
  now_ms: number
): Promise<CodeEntryDeps> {
  const [caller_code, matches, caller_connection_count] = await Promise.all([
    connect_code_repo.get_by_user(ctx, user_id),
    connect_code_repo.find_active_by_code(ctx, code, now_ms),
    connection_repo.count_connected(ctx, user_id),
  ]);
  const target = matches.length === 1 ? matches[0] : null;
  if (!target || target.user_id === user_id) {
    return {
      caller_code,
      target,
      existing_connection: null,
      caller_connection_count,
      target_connection_count: 0,
    };
  }
  const [existing_connection, target_connection_count] = await Promise.all([
    connection_repo.get(ctx, pair_id(user_id, target.user_id)),
    connection_repo.count_connected(ctx, target.user_id),
  ]);
  return {
    caller_code,
    target,
    existing_connection,
    caller_connection_count,
    target_connection_count,
  };
}

export interface OverviewDeps {
  connections: Connection[];
  groups: Group[];
  requests: SharingRequest[];
  request_groups: Record<string, Group>;
}

/** For get_sharing_overview. */
export async function resolve_overview(
  ctx: TraceContext,
  user_id: string
): Promise<OverviewDeps> {
  const [connections, groups, requests] = await Promise.all([
    connection_repo.get_for_user(ctx, user_id),
    group_repo.get_for_user(ctx, user_id),
    request_repo.get_pending_for_recipient(ctx, user_id),
  ]);
  const request_group_docs = await group_repo.get_many(
    ctx,
    requests.map((r) => r.group_id)
  );
  const request_groups: Record<string, Group> = {};
  for (const g of request_group_docs) request_groups[g.id] = g;
  return { connections, groups, requests, request_groups };
}

export interface ConnectionActionDeps {
  connection: Connection | null;
  /** Pending requests between the two people, either direction. */
  pending_between: SharingRequest[];
}

/** For manage_connection. */
export async function resolve_connection_action(
  ctx: TraceContext,
  user_id: string,
  other_user_id: string
): Promise<ConnectionActionDeps> {
  const [connection, mine, theirs] = await Promise.all([
    connection_repo.get(ctx, pair_id(user_id, other_user_id)),
    request_repo.get_pending_for_recipient(ctx, user_id),
    request_repo.get_pending_for_recipient(ctx, other_user_id),
  ]);
  const pending_between = [
    ...mine.filter((r) => r.from_user_id === other_user_id),
    ...theirs.filter((r) => r.from_user_id === user_id),
  ];
  return { connection, pending_between };
}

export interface InviteDeps {
  group: Group | null;
  /** invitee uid → their connection with the caller (null when none). */
  connections: Record<string, Connection | null>;
  /** Requests the caller sent in the last 24h (daily recipient limit). */
  sent_today: SharingRequest[];
}

/** For create_group / add_to_group: the caller's links to each invitee. */
export async function resolve_invites(
  ctx: TraceContext,
  user_id: string,
  group_id: string | null,
  invitee_ids: string[],
  now_ms: number
): Promise<InviteDeps> {
  const unique = [...new Set(invitee_ids)];
  const [group, sent_today, ...conns] = await Promise.all([
    group_id ? group_repo.get(ctx, group_id) : Promise.resolve(null),
    request_repo.get_sent_since(ctx, user_id, now_ms - DAY_MS),
    ...unique.map((uid) => connection_repo.get(ctx, pair_id(user_id, uid))),
  ]);
  const connections: Record<string, Connection | null> = {};
  unique.forEach((uid, i) => {
    connections[uid] = conns[i] as Connection | null;
  });
  return { group: group as Group | null, connections, sent_today: sent_today as SharingRequest[] };
}

/** For respond_to_request. */
export async function resolve_request(
  ctx: TraceContext,
  request_id: string
): Promise<{ request: SharingRequest | null; inviter_connection: Connection | null }> {
  const request = await request_repo.get(ctx, request_id);
  if (!request) return { request: null, inviter_connection: null };
  const inviter_connection = await connection_repo.get(
    ctx,
    pair_id(request.from_user_id, request.to_user_id)
  );
  return { request, inviter_connection };
}

/** For manage_group: pending requests to cancel when a group is deleted. */
export async function resolve_group_pending_requests(
  ctx: TraceContext,
  group_id: string
): Promise<SharingRequest[]> {
  return request_repo.get_pending_for_group(ctx, group_id);
}

// ---------------------------------------------------------------------------
// Phase 2.1: account placement
// ---------------------------------------------------------------------------

/** Repo account → the fields placement rules need. */
export function to_placeable(a: Account | null): PlaceableAccount | null {
  if (!a) return null;
  return {
    id: a.id,
    user_id: a.user_id,
    is_active: a.is_active,
    name: a.name,
    mask: a.mask ?? null,
    institution_id: a.institution.id,
    account_subtype: a.account_subtype,
    placement: a.placement ?? null,
  };
}

export interface ShareAccountDeps {
  account: PlaceableAccount | null;
  group: Group | null;
  group_accounts: PlaceableAccount[];
  pending_for_account: SharingRequest[];
  sent_today: SharingRequest[];
}

/** For share_account. */
export async function resolve_share_account(
  ctx: TraceContext,
  user_id: string,
  account_id: string,
  group_id: string,
  now_ms: number
): Promise<ShareAccountDeps> {
  const [account, group, shared, pending_for_account, sent_today] = await Promise.all([
    account_repo.get_by_id(ctx, account_id),
    group_repo.get(ctx, group_id),
    account_repo.get_shared_with_group(ctx, group_id),
    request_repo.get_pending_for_target(ctx, account_id),
    request_repo.get_sent_since(ctx, user_id, now_ms - DAY_MS),
  ]);
  return {
    account: to_placeable(account),
    group,
    group_accounts: shared.map((a) => to_placeable(a)!),
    pending_for_account,
    sent_today,
  };
}

/** For unshare_account and accepting a share request. */
export async function resolve_account_placement(
  ctx: TraceContext,
  account_id: string
): Promise<{ account: PlaceableAccount | null; pending: SharingRequest[] }> {
  const [account, pending] = await Promise.all([
    account_repo.get_by_id(ctx, account_id),
    request_repo.get_pending_for_target(ctx, account_id),
  ]);
  return { account: to_placeable(account), pending };
}

/** For accepting a share_account request: the account, its pending requests, the group. */
export async function resolve_share_accept(
  ctx: TraceContext,
  request: SharingRequest
): Promise<{ account: PlaceableAccount | null; pending: SharingRequest[]; group: Group | null }> {
  const [placement, group] = await Promise.all([
    resolve_account_placement(ctx, request.target_id ?? ""),
    group_repo.get(ctx, request.group_id),
  ]);
  return { ...placement, group };
}

/** For manage_group leave / remove / delete: accounts shared with the group. */
export async function resolve_group_accounts(
  ctx: TraceContext,
  group_id: string
): Promise<PlaceableAccount[]> {
  const shared = await account_repo.get_shared_with_group(ctx, group_id);
  return shared.map((a) => to_placeable(a)!);
}
