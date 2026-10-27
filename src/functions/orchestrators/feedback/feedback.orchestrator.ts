/**
 * Feedback orchestrators (Feedback-And-Questions)
 *
 * - send: resolver (no dependencies) → domain plan inside the repo transaction → one atomic write.
 *   The client-made note id IS the idempotency key: a retried send finds its own note and returns
 *   "deduped" without writing, so no separate idempotency record is kept.
 * - Sent tab: the sender's own list (read-only).
 * - status: is the caller an inbox owner, and how many notes are unread (owner only).
 * - inbox: owner-only list / mark read / open-done / delete. A non-owner gets PERMISSION_DENIED
 *   and never reads a note.
 *
 * @module orchestrators/feedback/feedback
 */

import { OrchestratorContext, TraceContext } from "../../types";
import { create_span, log_operation_start, log_operation_success } from "../../observability";
import { feedback_repo } from "../../repositories/feedback.repo";
import {
  resolve_inbox_flag,
  resolve_submit_feedback_dependencies,
} from "../../resolvers/feedback/feedback.resolver";
import {
  is_inbox_owner,
  plan_submit,
  to_inbox_item,
  to_my_items,
  after_owner_delete,
} from "../../domain/feedback/feedback.service";
import {
  FeedbackInboxInput,
  FeedbackInboxResult,
  FeedbackStatusResult,
  ListMyFeedbackResult,
  MAX_INBOX_NOTES,
  SubmitFeedbackInput,
  SubmitFeedbackResult,
} from "../../types/feedback.types";

/** Orchestrator outcome: data, or a client-facing refusal (code + message). */
export type FeedbackOutcome<T> =
  | { success: true; data: T }
  | { success: false; code: string; message: string };

export async function submit_feedback_orchestrator(
  ctx: OrchestratorContext<SubmitFeedbackInput>,
  now_ms: number = Date.now()
): Promise<FeedbackOutcome<SubmitFeedbackResult>> {
  const span = create_span(ctx, "orchestrator", "submit_feedback");
  log_operation_start(span, ctx.user_id);

  resolve_submit_feedback_dependencies(ctx);

  const outcome = await feedback_repo.submit_in_transaction<FeedbackOutcome<SubmitFeedbackResult>>(
    ctx,
    ctx.user_id,
    ctx.input.note_id,
    (sender, note_exists) => {
      const plan = plan_submit(ctx.input, sender, note_exists, now_ms);
      if (plan.kind === "write") {
        return {
          write: { note: plan.note, sender: plan.sender },
          result: {
            success: true as const,
            data: { note_id: plan.note.id, deduped: false, remaining_today: plan.remaining_today },
          },
        };
      }
      if (plan.kind === "deduped") {
        return {
          write: null,
          result: {
            success: true as const,
            data: {
              note_id: ctx.input.note_id,
              deduped: true,
              remaining_today: plan.remaining_today,
            },
          },
        };
      }
      return {
        write: null,
        result: { success: false as const, code: plan.code, message: plan.message },
      };
    }
  );

  log_operation_success(span, ctx.user_id);
  return outcome;
}

export async function list_my_feedback_orchestrator(
  ctx: TraceContext,
  user_id: string
): Promise<ListMyFeedbackResult> {
  const span = create_span(ctx, "orchestrator", "list_my_feedback");
  log_operation_start(span, user_id);
  const sender = await feedback_repo.get_sender(ctx, user_id);
  const ids = sender?.note_ids ?? [];
  const notes = ids.length > 0 ? await feedback_repo.get_notes(ctx, ids) : [];
  log_operation_success(span, user_id);
  return { notes: to_my_items(ids, notes) };
}

export async function feedback_status_orchestrator(
  ctx: TraceContext,
  user_id: string
): Promise<FeedbackStatusResult> {
  const flag = await resolve_inbox_flag(ctx);
  if (!is_inbox_owner(flag, user_id)) return { is_owner: false, inbox_unread: 0 };
  return { is_owner: true, inbox_unread: await feedback_repo.count_unread(ctx) };
}

export async function feedback_inbox_orchestrator(
  ctx: OrchestratorContext<FeedbackInboxInput>
): Promise<FeedbackOutcome<FeedbackInboxResult>> {
  const span = create_span(ctx, "orchestrator", `feedback_inbox:${ctx.input.action}`);
  log_operation_start(span, ctx.user_id);

  const flag = await resolve_inbox_flag(ctx);
  if (!is_inbox_owner(flag, ctx.user_id)) {
    return { success: false, code: "PERMISSION_DENIED", message: "Not allowed" };
  }

  const input = ctx.input;
  let data: FeedbackInboxResult;
  switch (input.action) {
  case "list": {
    const page = await feedback_repo.list_inbox(ctx, input.status, input.type, MAX_INBOX_NOTES);
    data = { action: "list", notes: page.notes.map(to_inbox_item), truncated: page.truncated };
    break;
  }
  case "mark_read": {
    const changed = await feedback_repo.update_note_fields(ctx, input.note_id, {
      read_by_owner: true,
    });
    data = { action: "mark_read", note_id: input.note_id, changed };
    break;
  }
  case "set_status": {
    // Done also counts as read: a note you closed shouldn't keep the badge up.
    const changed = await feedback_repo.update_note_fields(ctx, input.note_id, {
      status: input.status,
      ...(input.status === "done" ? { read_by_owner: true } : {}),
    });
    data = { action: "set_status", note_id: input.note_id, changed };
    break;
  }
  case "delete": {
    const changed = await feedback_repo.delete_note(ctx, input.note_id, (sender) =>
      after_owner_delete(sender, input.note_id)
    );
    data = { action: "delete", note_id: input.note_id, changed };
    break;
  }
  }

  log_operation_success(span, ctx.user_id);
  return { success: true, data };
}
