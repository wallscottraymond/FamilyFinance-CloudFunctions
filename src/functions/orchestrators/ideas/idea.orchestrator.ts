/**
 * Ideas orchestrators (Planning-Module v1)
 *
 * Every write: flag check → resolver (who owns the list, may the caller use it) → domain plan
 * inside the repo transaction → one atomic write. Client-made ids (idea, comment) make retries
 * safe: a retried create / comment finds its own doc and returns without writing.
 *
 * An idea the caller can't see answers NOT_FOUND (never "it exists but isn't yours").
 *
 * @module orchestrators/ideas/idea
 */

import { OrchestratorContext, TraceContext } from "../../types";
import { create_span, log_operation_start, log_operation_success } from "../../observability";
import { idea_repo, IdeaSnapshot } from "../../repositories/idea.repo";
import {
  resolve_idea,
  resolve_idea_dependencies,
  resolve_ideas_enabled,
  resolve_list_group,
  resolve_open_count,
} from "../../resolvers/ideas/idea.resolver";
import {
  can_use_list,
  IdeaPlan,
  plan_comment,
  plan_convert,
  plan_create,
  plan_delete,
  plan_delete_comment,
  plan_edit,
  plan_like,
  plan_restore,
} from "../../domain/ideas/idea.service";
import { group_view_key } from "../../domain/sharing/budget_view.service";
import {
  CreateIdeaInput,
  CreateIdeaResult,
  DeleteIdeaInput,
  DeleteIdeaResult,
  ReactToIdeaInput,
  ReactToIdeaResult,
  UpdateIdeaInput,
  UpdateIdeaResult,
} from "../../types/ideas.types";

/** Orchestrator outcome: data, or a client-facing refusal (code + message). */
export type IdeaOutcome<T> =
  | { success: true; data: T }
  | { success: false; code: string; message: string };

const OFF: IdeaOutcome<never> = {
  success: false,
  code: "FEATURE_DISABLED",
  message: "Ideas aren't available yet.",
};
const NOT_FOUND: IdeaOutcome<never> = {
  success: false,
  code: "NOT_FOUND",
  message: "This idea isn't available.",
};

function to_outcome<R>(plan: IdeaPlan<R>): IdeaOutcome<R> {
  return plan.kind === "rejected"
    ? { success: false, code: plan.code, message: plan.message }
    : { success: true, data: plan.result };
}

/** The idea's owner key when the caller may use its list; null = treat as not found. */
async function resolve_usable_list(
  ctx: TraceContext,
  idea_id: string,
  user_id: string
): Promise<string | null> {
  const idea = await resolve_idea(ctx, idea_id);
  if (!idea) return null;
  const group = await resolve_list_group(ctx, idea.owner_key);
  return can_use_list(idea.owner_key, user_id, group) ? idea.owner_key : null;
}

/** Inside the transaction the idea must still exist and still be in the same list. */
type WithIdea = IdeaSnapshot & { idea: NonNullable<IdeaSnapshot["idea"]> };

function with_idea<R>(
  owner_key: string,
  fn: (snap: WithIdea) => IdeaPlan<R>
): (snap: IdeaSnapshot) => IdeaPlan<R> {
  return (snap: IdeaSnapshot): IdeaPlan<R> => {
    if (!snap.idea || snap.idea.owner_key !== owner_key) {
      return { kind: "rejected", code: "NOT_FOUND", message: "This idea isn't available." };
    }
    return fn({ ...snap, idea: snap.idea });
  };
}

export async function create_idea_orchestrator(
  ctx: OrchestratorContext<CreateIdeaInput>,
  now_ms: number = Date.now()
): Promise<IdeaOutcome<CreateIdeaResult>> {
  const span = create_span(ctx, "orchestrator", "create_idea");
  log_operation_start(span, ctx.user_id);
  if (!(await resolve_ideas_enabled(ctx, ctx.user_id))) return OFF;

  resolve_idea_dependencies(ctx);
  const owner_key = ctx.input.view_group_id
    ? group_view_key(ctx.input.view_group_id)
    : ctx.user_id;
  const group = await resolve_list_group(ctx, owner_key);
  if (!can_use_list(owner_key, ctx.user_id, group)) {
    return { success: false, code: "PERMISSION_DENIED", message: "You're not in this group." };
  }
  const open_count = await resolve_open_count(ctx, owner_key);

  const plan = await idea_repo.apply_in_transaction(
    ctx,
    { idea_id: ctx.input.idea_id, owner_key },
    (snap) => {
      const c = { owner_key, actor_id: ctx.user_id, now_ms, open_count };
      return plan_create(ctx.input, c, snap.idea, snap.topics);
    }
  );
  log_operation_success(span, ctx.user_id);
  return to_outcome(plan);
}

export async function update_idea_orchestrator(
  ctx: OrchestratorContext<UpdateIdeaInput>,
  now_ms: number = Date.now()
): Promise<IdeaOutcome<UpdateIdeaResult>> {
  const span = create_span(ctx, "orchestrator", `update_idea:${ctx.input.action}`);
  log_operation_start(span, ctx.user_id);
  if (!(await resolve_ideas_enabled(ctx, ctx.user_id))) return OFF;

  resolve_idea_dependencies(ctx);
  const owner_key = await resolve_usable_list(ctx, ctx.input.idea_id, ctx.user_id);
  if (!owner_key) return NOT_FOUND;

  const input = ctx.input;
  const open_count = input.action === "restore" ? await resolve_open_count(ctx, owner_key) : 0;
  const plan = await idea_repo.apply_in_transaction(
    ctx,
    { idea_id: input.idea_id, owner_key },
    with_idea(owner_key, ({ idea, topics }) => {
      switch (input.action) {
      case "edit":
        return plan_edit(idea, input.fields, ctx.user_id, now_ms, topics);
      case "convert":
        return plan_convert(idea, input.converted_to, ctx.user_id, now_ms, topics);
      case "restore":
        return plan_restore(idea, ctx.user_id, now_ms, topics, open_count);
      }
    })
  );
  // The comments follow the idea: they expire with a converted idea, and stay when restored.
  if (plan.kind === "write" && plan.idea && input.action !== "edit") {
    await idea_repo.set_comments_expiry(ctx, input.idea_id, owner_key, plan.idea.expire_at_ms);
  }
  log_operation_success(span, ctx.user_id);
  return to_outcome(plan);
}

export async function delete_idea_orchestrator(
  ctx: OrchestratorContext<DeleteIdeaInput>
): Promise<IdeaOutcome<DeleteIdeaResult>> {
  const span = create_span(ctx, "orchestrator", "delete_idea");
  log_operation_start(span, ctx.user_id);
  if (!(await resolve_ideas_enabled(ctx, ctx.user_id))) return OFF;

  resolve_idea_dependencies(ctx);
  const owner_key = await resolve_usable_list(ctx, ctx.input.idea_id, ctx.user_id);
  // Already gone (or never visible): deleting is done either way.
  if (!owner_key) return { success: true, data: { idea_id: ctx.input.idea_id, deleted: false } };

  // Comments first: if this fails the idea is still here, so a retry finds it and cleans up.
  await idea_repo.delete_comments(ctx, ctx.input.idea_id, owner_key);
  const plan = await idea_repo.apply_in_transaction(
    ctx,
    { idea_id: ctx.input.idea_id, owner_key },
    (snap) => {
      const same_list = snap.idea && snap.idea.owner_key === owner_key ? snap.idea : null;
      return plan_delete(ctx.input.idea_id, same_list, snap.topics);
    }
  );
  // A comment posted in between would be left behind: sweep once more (best effort).
  if (plan.kind === "write") {
    await idea_repo.delete_comments(ctx, ctx.input.idea_id, owner_key).catch(() => 0);
  }
  log_operation_success(span, ctx.user_id);
  return to_outcome(plan);
}

export async function react_to_idea_orchestrator(
  ctx: OrchestratorContext<ReactToIdeaInput>,
  now_ms: number = Date.now()
): Promise<IdeaOutcome<ReactToIdeaResult>> {
  const span = create_span(ctx, "orchestrator", `react_to_idea:${ctx.input.action}`);
  log_operation_start(span, ctx.user_id);
  if (!(await resolve_ideas_enabled(ctx, ctx.user_id))) return OFF;

  resolve_idea_dependencies(ctx);
  const owner_key = await resolve_usable_list(ctx, ctx.input.idea_id, ctx.user_id);
  if (!owner_key) return NOT_FOUND;

  const input = ctx.input;
  const comment_id = input.action === "like" ? undefined : input.comment_id;
  const plan = await idea_repo.apply_in_transaction<ReactToIdeaResult>(
    ctx,
    { idea_id: input.idea_id, owner_key, comment_id },
    with_idea<ReactToIdeaResult>(owner_key, ({ idea, comment }) => {
      switch (input.action) {
      case "like":
        return plan_like(idea, ctx.user_id, input.liked, now_ms);
      case "comment":
        return plan_comment(idea, input.comment_id, input.text, comment, ctx.user_id, now_ms);
      case "delete_comment":
        return plan_delete_comment(idea, input.comment_id, comment, ctx.user_id);
      }
    })
  );
  log_operation_success(span, ctx.user_id);
  return to_outcome(plan);
}

/** The app can't read `_feature_flags`, so it asks. Returns ONLY `{enabled}`. */
export async function get_ideas_capabilities_orchestrator(
  ctx: TraceContext,
  user_id: string
): Promise<{ enabled: boolean }> {
  return { enabled: await resolve_ideas_enabled(ctx, user_id) };
}
