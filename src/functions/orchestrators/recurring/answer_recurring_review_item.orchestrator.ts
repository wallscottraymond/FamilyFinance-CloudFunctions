/**
 * Answer Recurring Review Item Orchestrator (Convert-To-Recurring Phase 1, D9 / D14 / D24).
 *
 * One tap on a Bills-to-review tile (period page or the list — they read the same item):
 *   resolve (owner-only auth) → plan (pure) → write the item + the review state (only if changed;
 *   a held-out-set change bumps the derive version) → the record action ("Still a bill" ack on the
 *   record; "It ended" = the going-forward end, via the removal orchestrator) → for "track" /
 *   "keep separate" a re-sync of the item, so its planner creates the v2 bill now (one sync path:
 *   stamping, periods, linking, follow-ups all as for any new bill).
 *
 * Flag-gated (X11): with the flag off the callable refuses. Idempotent: the same answer again is a
 * no-op (R12).
 *
 * @module orchestrators/recurring/answer_recurring_review_item
 */

import { TraceContext, NotFoundError, PermissionDeniedError, ValidationError } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import { is_convert_to_recurring_enabled } from "../../infrastructure/feature_flags";
import { recurring_review_repo } from "../../repositories/recurring_review.repo";
import { inflow_repo, outflow_repo } from "../../repositories";
import { bump_derive_version } from "../../repositories/derive_version.repo";
import { resolve_review_answer_context } from "../../resolvers/recurring/review_answer.resolver";
import { plan_review_answer, UserAnswer } from "../../domain/recurring/review_answer.service";
import { apply_review_state_change } from "../../domain/recurring/review_item.service";
import { manage_recurring_removal_orchestrator } from "./manage_recurring_removal.orchestrator";
import { enqueue_item_sync } from "../plaid/sync_item.orchestrator";

export interface AnswerReviewItemInput {
  item_id: string;
  answer: UserAnswer;
  /** The schedule picked when tracking a Plaid suggestion with an UNKNOWN frequency (D8). */
  frequency?: string | null;
}

export interface AnswerReviewItemResult {
  item_id: string;
  status: string;
  answer: string;
  no_op: boolean;
}

export async function answer_recurring_review_item_orchestrator(
  ctx: TraceContext,
  user_id: string,
  input: AnswerReviewItemInput,
  now_ms: number
): Promise<AnswerReviewItemResult> {
  const span = create_span(ctx, "orchestrator", "answer_recurring_review_item");
  log_operation_start(span, user_id);
  try {
    if (!(await is_convert_to_recurring_enabled(user_id))) {
      throw new ValidationError(["Bills to review isn't available on this account yet"]);
    }
    // 1. Resolve (owner-only).
    const context = await resolve_review_answer_context(ctx, user_id, input.item_id);
    if (!context.ok) {
      if (context.reason === "not_found") throw new NotFoundError("recurring_review_item", input.item_id);
      throw new PermissionDeniedError("answer_recurring_review_item", input.item_id);
    }
    if (!context.record_owner_ok) throw new PermissionDeniedError("answer_recurring_review_item", input.item_id);

    // 2. Plan (pure).
    const result = plan_review_answer(context.item, input.answer, now_ms, { frequency: input.frequency });
    if (!result.ok) throw new ValidationError([result.error]);
    const plan = result.plan;
    if (plan.no_op) {
      log_operation_success(span, user_id);
      return { item_id: input.item_id, status: context.item.status, answer: input.answer, no_op: true };
    }

    // 3. Record action first (so a failure leaves the question open, to be answered again).
    const item = context.item;
    if (plan.record_action === "ack_still_a_bill" && item.record_id) {
      const repo = item.direction === "outflow" ? outflow_repo : inflow_repo;
      await repo.set_plaid_inactive_ack(ctx, item.record_id, now_ms, user_id);
    } else if (plan.record_action === "end" && item.record_id) {
      await manage_recurring_removal_orchestrator(
        ctx,
        user_id,
        [],
        { id: item.record_id, action: "end" },
        now_ms,
        item.direction === "outflow" ? outflow_repo : inflow_repo,
        item.direction === "outflow" ? "recurring_outflow" : "recurring_inflow"
      );
    }

    // 4. The item + the review state.
    await recurring_review_repo.upsert_items(ctx, [plan.item!]);
    const next = apply_review_state_change(context.state, user_id, plan.state_change);
    if (next.changed) await recurring_review_repo.set_state(ctx, next.next);
    if (next.suppressed_changed) await bump_derive_version(user_id).catch(() => {});

    // 5. "Track" / "keep separate": re-sync the item now so the bill exists right away.
    if (plan.resync_item_doc_id) {
      await enqueue_item_sync({
        item_doc_id: plan.resync_item_doc_id,
        user_id,
        recurring: true,
        reason: `review_${input.answer}`,
        trace_id: ctx.trace_id,
      });
    }

    log_operation_success(span, user_id);
    return { item_id: input.item_id, status: plan.item!.status, answer: input.answer, no_op: false };
  } catch (error) {
    log_operation_error(span, error instanceof Error ? error : new Error(String(error)), { user_id });
    throw error;
  }
}
