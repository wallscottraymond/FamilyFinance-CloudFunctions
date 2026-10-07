/**
 * Account Placement Orchestrators (P1, D7, N9, I4, D25)
 *
 * share_account: the owner shares an account with a group (requests to the
 * other members, or applied at once in a group of one).
 * unshare_account: the owner makes it private again (no Accept needed).
 *
 * Accepting a share request lives in respond_to_request (groups orchestrator).
 *
 * @module orchestrators/sharing/placement
 */

import { OrchestratorContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
} from "../../observability";
import {
  resolve_share_account,
  resolve_account_placement,
} from "../../resolvers/sharing/sharing.resolver";
import {
  plan_share_account,
  plan_unshare_account,
} from "../../domain/sharing/placement.service";
import { cancel_requests } from "../../domain/sharing/request.service";
import { person_view } from "../../domain/sharing/names.service";
import { PersonView } from "../../types/sharing.types";
import { account_repo } from "../../repositories/account.repo";
import { request_repo } from "../../repositories/sharing";

export interface ShareAccountResult {
  success: boolean;
  errors?: string[];
  /** "shared" = applied now; "requested" = waiting for a member to accept. */
  status?: "shared" | "requested";
  /** Set when someone in the group already shares the same real account (I4). */
  already_shared_by?: PersonView;
}

/** Shares an account with a group. */
export async function share_account_orchestrator(
  ctx: OrchestratorContext<{ account_id: string; group_id: string; include_history: boolean }>
): Promise<ShareAccountResult> {
  const span = create_span(ctx, "orchestrator", "share_account");
  log_operation_start(span, ctx.user_id);
  const now_ms = Date.now();

  // 1. RESOLVER
  const deps = await resolve_share_account(
    ctx, ctx.user_id, ctx.input.account_id, ctx.input.group_id, now_ms
  );

  // 2. DOMAIN
  const plan = plan_share_account({
    account: deps.account,
    caller_id: ctx.user_id,
    group: deps.group,
    include_history: ctx.input.include_history,
    group_accounts: deps.group_accounts,
    pending_for_account: deps.pending_for_account,
    sent_today: deps.sent_today,
    now_ms,
    new_request_id: () => request_repo.new_id(),
  });
  if (plan.validation_errors?.length || !plan.entity) {
    const dup = plan.entity?.duplicate_owner_id;
    return {
      success: false,
      errors: plan.validation_errors,
      already_shared_by: dup ? person_view(dup, {}) : undefined,
    };
  }

  // 3. REPOSITORY
  if (plan.entity.placement) {
    await account_repo.set_placement(
      ctx, ctx.input.account_id, plan.entity.placement, ctx.user_id
    );
  }
  await request_repo.save_many(ctx, plan.entity.requests);

  log_operation_success(span, ctx.user_id);
  return { success: true, status: plan.entity.placement ? "shared" : "requested" };
}

/** Makes a shared account private again; cancels any pending share requests. */
export async function unshare_account_orchestrator(
  ctx: OrchestratorContext<{ account_id: string }>
): Promise<ShareAccountResult> {
  const span = create_span(ctx, "orchestrator", "unshare_account");
  log_operation_start(span, ctx.user_id);
  const now_ms = Date.now();

  // 1. RESOLVER
  const { account, pending } = await resolve_account_placement(ctx, ctx.input.account_id);

  // 2. DOMAIN
  const mine = account && account.user_id === ctx.user_id;
  const plan = plan_unshare_account(account, ctx.user_id);
  const cancelled = mine ? cancel_requests(pending, now_ms) : [];
  if ((plan.validation_errors?.length || !plan.entity) && cancelled.length === 0) {
    return { success: false, errors: plan.validation_errors };
  }

  // 3. REPOSITORY (cancelling a pending share counts as unsharing too)
  if (plan.entity) {
    await account_repo.set_placement(ctx, ctx.input.account_id, null, ctx.user_id);
  }
  await request_repo.save_many(ctx, cancelled);

  log_operation_success(span, ctx.user_id);
  return { success: true };
}
