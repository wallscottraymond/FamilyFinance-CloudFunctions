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
import { txn_facts } from "../../resolvers/recurring/convert.resolver";
import { transaction_repo } from "../../repositories/transaction.repo";
import { plan_merge_old_into_new } from "../../domain/recurring/merge.service";
import { resolve_last_payment_ms } from "../../resolvers/recurring/last_payment.resolver";
import { enqueue_reassign_user } from "../transactions/reassign_user.orchestrator";
import { convert_transaction_to_recurring_orchestrator } from "./convert_transaction_to_recurring.orchestrator";
import { ConvertFrequency, CONVERT_FREQUENCIES } from "../../domain/recurring/convert_recurring.service";

export interface AnswerReviewItemInput {
  item_id: string;
  answer: UserAnswer;
  /** The schedule picked when tracking a Plaid suggestion with an UNKNOWN frequency (D8). */
  frequency?: string | null;
  /** Detector "Track": the confirm sheet's values (defaults come from the suggestion). */
  name?: string;
  amount?: number;
  next_due_date?: string;
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

    // 2b. A detector suggestion tracked = converted from its latest payment (D4): the convert
    //     orchestrator makes the bill, links the past payments and closes the item `converted`.
    if (plan.convert) {
      const item = context.item;
      const docs = await transaction_repo.get_raw_by_ids(ctx, item.transaction_ids);
      const latest = docs
        // …of THIS suggestion's vendor (a payment of another vendor would fail the review match).
        .filter((d) => d.data.isActive !== false && d.data.isPending !== true && (!item.account_id || d.data.accountId === item.account_id) &&
          txn_facts(d.id, d.data, false).vendor_key === item.vendor_key)
        .sort((a, b) => ((b.data.transactionDate as { toMillis(): number }).toMillis()) - ((a.data.transactionDate as { toMillis(): number }).toMillis()))[0];
      if (!latest) throw new ValidationError(["the payments behind this suggestion are gone"]);
      const freq = (input.frequency ?? item.user_frequency ?? item.frequency) as ConvertFrequency | null;
      if (!freq || !CONVERT_FREQUENCIES.includes(freq)) throw new ValidationError(["pick a schedule for this bill"]);
      const due_ms = item.next_due_ms ?? now_ms;
      await convert_transaction_to_recurring_orchestrator(ctx, user_id, {
        transaction_id: latest.id,
        name: input.name ?? item.name,
        amount: input.amount ?? item.amount,
        frequency: freq,
        next_due_date: input.next_due_date ?? new Date(due_ms).toISOString().slice(0, 10),
        link_past: true,
        review_item_id: item.id,
      }, now_ms);
      log_operation_success(span, user_id);
      return { item_id: input.item_id, status: "resolved", answer: "converted", no_op: false };
    }

    // 2c. "Same bill" (D7 / D22): the old bill ends after its last payment and is merged into the
    //     new stream's bill (kept active, out of the Removed list, undoable). One stamped write +
    //     the stored periods follow + ONE coalesced re-assign of its account.
    if (plan.merge) {
      const old_id = plan.merge.old_record_id;
      const repo = context.item.direction === "outflow" ? outflow_repo : inflow_repo;
      const old = await repo.get_by_id(ctx, old_id, { include_deleted: true });
      if (old && old.user_id === user_id) {
        const month_start = Date.UTC(new Date(now_ms).getUTCFullYear(), new Date(now_ms).getUTCMonth(), 1);
        const mp = plan_merge_old_into_new({
          id: old.id, removal_intervals: old.removal_intervals, user_custom_name: old.user_custom_name,
          expected_amount_override: old.expected_amount_override, user_frequency: old.user_frequency ?? null,
          last_payment_ms: await resolve_last_payment_ms(ctx, user_id, context.item.direction, old.id, old.last_date?.toMillis?.() ?? null),
          merged_into_id: old.merged_into_id, is_active: old.is_active,
        }, plan.merge.into_stream_id, now_ms, month_start);
        if (mp) {
          await repo.apply_merge(ctx, old_id, { intervals: mp.intervals, merged_into_id: plan.merge.into_stream_id, merge_log: mp.merge_log }, `merge_${ctx.trace_id}`);
          await repo.apply_period_suppression(ctx, old_id, mp.intervals, user_id);
          await enqueue_reassign_user({
            user_id,
            reason: "recurring_removal",
            scope: { ...(old.account_id ? { account_ids: [old.account_id] } : {}), from_ms: Math.min(month_start, mp.intervals[mp.intervals.length - 1].from_ms) },
          }, ctx.trace_id).catch((e) => console.error(`[${ctx.trace_id}] merge re-assign enqueue failed:`, e));
          await bump_derive_version(user_id).catch(() => {});
        }
      }
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
    if (apply_review_state_change(context.state, user_id, plan.state_change).changed) {
      // Atomic against the fresh doc (a concurrent sync / detector write is never lost).
      const next = await recurring_review_repo.apply_state_change(ctx, user_id, plan.state_change);
      if (next.suppressed_changed) await bump_derive_version(user_id).catch(() => {});
    }

    // 5. "Track" / "keep separate": re-sync the item now so the bill exists right away.
    if (plan.resync_item_doc_id) {
      try {
        await enqueue_item_sync({
          item_doc_id: plan.resync_item_doc_id,
          user_id,
          recurring: true,
          reason: `review_${input.answer}`,
          trace_id: ctx.trace_id,
        });
      } catch (error) {
        // The new bill can't be made: a "same bill" merge written above must not strand the old one.
        if (plan.merge) {
          const repo = context.item.direction === "outflow" ? outflow_repo : inflow_repo;
          const old = await repo.get_by_id(ctx, plan.merge.old_record_id, { include_deleted: true });
          const log = old?.merge_log;
          if (old && log) {
            await repo.clear_merge(ctx, old.id, log.prior_intervals, `merge_rollback_${ctx.trace_id}`, log.prior_is_active);
            await repo.apply_period_suppression(ctx, old.id, log.prior_intervals, user_id);
            await bump_derive_version(user_id).catch(() => {});
          }
        }
        throw error;
      }
    }

    log_operation_success(span, user_id);
    return { item_id: input.item_id, status: plan.item!.status, answer: input.answer, no_op: false };
  } catch (error) {
    log_operation_error(span, error instanceof Error ? error : new Error(String(error)), { user_id });
    throw error;
  }
}
