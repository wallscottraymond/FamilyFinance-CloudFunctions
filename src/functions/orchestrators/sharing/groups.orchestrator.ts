/**
 * Group Orchestrators (D4, D24–D26, D30)
 *
 * create_group: creates the group (caller = owner) and sends join requests.
 * add_to_group: sends a join request to a connected person.
 * respond_to_request: accept (joins atomically) or decline.
 * manage_group: rename / remove_member / transfer_ownership / leave / delete.
 *
 * Joining never happens without the invitee's Accept (D25).
 *
 * @module orchestrators/sharing/groups
 */

import { OrchestratorContext } from "../../types";
import { Group, GroupMutation, SharingRequest } from "../../types/sharing.types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
} from "../../observability";
import {
  resolve_invites,
  resolve_request,
  resolve_group_pending_requests,
  resolve_share_accept,
  resolve_group_accounts,
} from "../../resolvers/sharing/sharing.resolver";
import {
  placement_on_accept,
  placements_released,
  requests_released,
} from "../../domain/sharing/placement.service";
import { account_repo } from "../../repositories/account.repo";
import {
  build_group,
  validate_invite,
  accept_join,
  leave_group,
  remove_member,
  transfer_ownership,
  rename_group,
  delete_group,
} from "../../domain/sharing/group.service";
import {
  build_join_request,
  check_daily_recipient_limit,
  answer_request,
  cancel_requests,
  is_open,
} from "../../domain/sharing/request.service";
import { is_connected } from "../../domain/sharing/connection.service";
import { group_repo, request_repo } from "../../repositories/sharing";
import { DomainResult } from "../../types";
import { ensure_group_everything_else } from "./group_everything_else";
import { return_moved_in_budgets } from "./budget_view.orchestrator";
import { bump_owner_versions } from "./versions";

export interface SharingWriteResult {
  success: boolean;
  errors?: string[];
  group_id?: string;
}

const fail = (errors?: string[]): SharingWriteResult => ({
  success: false,
  errors: errors && errors.length ? errors : ["Something went wrong"],
});

/** Pure: the join requests to send, or the reasons they can't be sent. */
function plan_invites(
  group: Group | null,
  caller_id: string,
  invitee_ids: string[],
  deps: Awaited<ReturnType<typeof resolve_invites>>,
  pending_to: Set<string>,
  now_ms: number
): DomainResult<SharingRequest> {
  const errors: string[] = [];
  const to_send = invitee_ids.filter((uid) => !pending_to.has(uid));
  for (const uid of to_send) {
    errors.push(
      ...validate_invite(group, caller_id, uid, is_connected(deps.connections[uid]?.status ?? null))
    );
  }
  errors.push(...check_daily_recipient_limit(deps.sent_today, to_send, now_ms));
  if (errors.length) return { validation_errors: [...new Set(errors)] };
  return {
    entities: to_send.map((uid) =>
      build_join_request(request_repo.new_id(), caller_id, uid, group!.id, now_ms)
    ),
  };
}

/** Creates a group and invites connected people. */
export async function create_group_orchestrator(
  ctx: OrchestratorContext<{ name: string; invitee_ids: string[] }>
): Promise<SharingWriteResult> {
  const span = create_span(ctx, "orchestrator", "create_group");
  log_operation_start(span, ctx.user_id);
  const now_ms = Date.now();
  const group_id = group_repo.new_id();
  const invitees = [...new Set(ctx.input.invitee_ids)].filter((u) => u !== ctx.user_id);

  // 1. RESOLVER
  const deps = await resolve_invites(ctx, ctx.user_id, null, invitees, now_ms);

  // 2. DOMAIN: check the invites against the would-be group before creating it
  const preview = build_group(group_id, ctx.input.name, ctx.user_id, 0, now_ms);
  if (preview.validation_errors?.length || !preview.entity) return fail(preview.validation_errors);
  const invites = plan_invites(
    preview.entity.group, ctx.user_id, invitees, deps, new Set(), now_ms
  );
  if (invites.validation_errors?.length) return fail(invites.validation_errors);

  // 3. REPOSITORY: group + owner's groupIds atomically (limit re-checked on fresh data)
  const created = await group_repo.apply_mutation(
    ctx,
    group_id,
    [ctx.user_id],
    (_group, counts) =>
      build_group(group_id, ctx.input.name, ctx.user_id, counts[ctx.user_id] ?? 0, now_ms),
    now_ms
  );
  if (created.validation_errors?.length) return fail(created.validation_errors);
  await request_repo.save_many(ctx, invites.entities ?? []);
  await ensure_group_everything_else(ctx, group_id);

  log_operation_success(span, ctx.user_id);
  return { success: true, group_id };
}

/** Sends a join request to someone the caller is connected with. */
export async function add_to_group_orchestrator(
  ctx: OrchestratorContext<{ group_id: string; invitee_id: string }>
): Promise<SharingWriteResult> {
  const span = create_span(ctx, "orchestrator", "add_to_group");
  log_operation_start(span, ctx.user_id);
  const now_ms = Date.now();

  // 1. RESOLVER
  const deps = await resolve_invites(
    ctx, ctx.user_id, ctx.input.group_id, [ctx.input.invitee_id], now_ms
  );
  const pending = (await resolve_group_pending_requests(ctx, ctx.input.group_id))
    .filter((r) => is_open(r, now_ms));
  const pending_to = new Set(pending.map((r) => r.to_user_id));

  // 2. DOMAIN
  if (pending_to.has(ctx.input.invitee_id)) {
    return fail(["They already have an invite to this group"]);
  }
  const invites = plan_invites(
    deps.group, ctx.user_id, [ctx.input.invitee_id], deps, pending_to, now_ms
  );
  if (invites.validation_errors?.length) return fail(invites.validation_errors);

  // 3. REPOSITORY
  await request_repo.save_many(ctx, invites.entities ?? []);

  log_operation_success(span, ctx.user_id);
  return { success: true, group_id: ctx.input.group_id };
}

/** Accepts or declines a request addressed to the caller. */
export async function respond_to_request_orchestrator(
  ctx: OrchestratorContext<{ request_id: string; accept: boolean }>
): Promise<SharingWriteResult> {
  const span = create_span(ctx, "orchestrator", "respond_to_request");
  log_operation_start(span, ctx.user_id);
  const now_ms = Date.now();

  // 1. RESOLVER
  const { request, inviter_connection } = await resolve_request(ctx, ctx.input.request_id);

  // 2. DOMAIN
  const answered = answer_request(request, ctx.user_id, ctx.input.accept, now_ms);
  if (answered.validation_errors?.length || !answered.entity) {
    return fail(answered.validation_errors);
  }
  const answer = answered.entity;
  if (ctx.input.accept && !is_connected(inviter_connection?.status ?? null)) {
    return fail(["This request isn't available"]);
  }

  // 3. REPOSITORY
  if (!ctx.input.accept) {
    await request_repo.save_many(ctx, [answer]);
    log_operation_success(span, ctx.user_id);
    return { success: true, group_id: answer.group_id };
  }
  if (answer.type === "share_account") {
    // First Accept from any member applies the share (PD5); the other members'
    // copies of the request are cancelled.
    const deps = await resolve_share_accept(ctx, answer);
    const placement = placement_on_accept(answer, deps.account, deps.group, now_ms);
    if (placement.validation_errors?.length || !placement.entity) {
      return fail(placement.validation_errors);
    }
    const siblings = cancel_requests(
      deps.pending.filter((r) => r.id !== answer.id),
      now_ms
    );
    if (!deps.account!.placement) {
      await account_repo.set_placement(
        ctx, deps.account!.id, placement.entity, answer.from_user_id
      );
      await bump_owner_versions([answer.from_user_id]);
    }
    await request_repo.save_many(ctx, [answer, ...siblings]);
    log_operation_success(span, ctx.user_id);
    return { success: true, group_id: answer.group_id };
  }
  const joined = await group_repo.apply_mutation(
    ctx,
    answer.group_id,
    [ctx.user_id],
    (group, counts) => accept_join(group, ctx.user_id, counts[ctx.user_id] ?? 0, now_ms),
    now_ms,
    (tx) => request_repo.set_in_transaction(tx, answer)
  );
  if (joined.validation_errors?.length) return fail(joined.validation_errors);

  log_operation_success(span, ctx.user_id);
  return { success: true, group_id: answer.group_id };
}

export type ManageGroupInput =
  | { group_id: string; action: "rename"; name: string }
  | { group_id: string; action: "remove_member"; user_id: string }
  | { group_id: string; action: "transfer_ownership"; user_id: string }
  | { group_id: string; action: "leave" }
  | { group_id: string; action: "delete" };

/**
 * Owner / member group management. Leaving / removal / deletion also make the
 * departing people's shared accounts private again and cancel their pending
 * requests, and budgets they moved in go back to their Me view (D13).
 */
export async function manage_group_orchestrator(
  ctx: OrchestratorContext<ManageGroupInput>
): Promise<SharingWriteResult> {
  const span = create_span(ctx, "orchestrator", "manage_group");
  log_operation_start(span, ctx.user_id);
  const now_ms = Date.now();
  const input = ctx.input;
  const caller = ctx.user_id;

  // 1. RESOLVER (the group itself is read inside the transaction below)
  const departs =
    input.action === "delete" || input.action === "leave" || input.action === "remove_member";
  const [pending, group_accounts] = departs
    ? await Promise.all([
      resolve_group_pending_requests(ctx, input.group_id),
      resolve_group_accounts(ctx, input.group_id),
    ])
    : [[], []];

  // 2. DOMAIN rule (run on fresh data inside the transaction)
  const rule = (group: Group | null): DomainResult<GroupMutation> => {
    switch (input.action) {
    case "rename": return rename_group(group, caller, input.name);
    case "remove_member": return remove_member(group, caller, input.user_id);
    case "transfer_ownership": return transfer_ownership(group, caller, input.user_id);
    case "leave": return leave_group(group, caller, now_ms);
    case "delete": return delete_group(group, caller, now_ms);
    }
  };

  // 3. REPOSITORY
  const result = await group_repo.apply_mutation(ctx, input.group_id, [], rule, now_ms);
  if (result.validation_errors?.length || !result.entity) return fail(result.validation_errors);
  // 4. DEPARTURES (D13): who left decides which accounts / requests are released.
  if (departs) {
    const deleted = result.entity.group.deleted_at_ms !== null;
    const leaving: string[] | "all" = deleted
      ? "all"
      : result.entity.user_changes.filter((c) => c.remove).map((c) => c.user_id);
    const released = placements_released(group_accounts, input.group_id, leaving);
    await account_repo.clear_placements(ctx, released, caller);
    await bump_owner_versions(
      group_accounts.filter((a) => released.includes(a.id)).map((a) => a.user_id)
    );
    await request_repo.save_many(
      ctx, cancel_requests(requests_released(pending, leaving), now_ms)
    );
    await return_moved_in_budgets(ctx, input.group_id, leaving, caller);
  }

  log_operation_success(span, ctx.user_id);
  return { success: true, group_id: input.group_id };
}
