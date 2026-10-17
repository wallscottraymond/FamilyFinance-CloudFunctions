/**
 * Undo Recurring Merge Orchestrator (Convert-To-Recurring D18 / D22 / D41, review items 8-9, 13).
 *
 * Two undos, both owner-only and flag-gated:
 *   - `merge`: a same-bill merge (or a convert over an old bill) — the old bill gets its intervals
 *     back, loses mergedIntoId / mergeLog, the new bill's inherited name / override are reset where
 *     the user hasn't changed them since, the "same bill?" question becomes `keep_separate`, and the
 *     account re-assigns once. The merge target may be gone (deleted): the old bill is still restored.
 *   - `absorb`: a Plaid stream a converted bill absorbed is marked `declined`; the next sync creates
 *     a separate bill for it.
 * Ownership is checked on the old bill AND on the merge target.
 *
 * @module orchestrators/recurring/undo_recurring_merge
 */

import { TraceContext, ConvertRefusedError, NotFoundError, PermissionDeniedError } from "../../types";
import { create_span, log_operation_start, log_operation_success, log_operation_error } from "../../observability";
import { is_convert_to_recurring_enabled } from "../../infrastructure/feature_flags";
import { is_user_purging } from "../../infrastructure/purge_guard";
import { inflow_repo, outflow_repo } from "../../repositories";
import { recurring_review_repo } from "../../repositories/recurring_review.repo";
import { bump_derive_version } from "../../repositories/derive_version.repo";
import { plan_undo_merge } from "../../domain/recurring/merge.service";
import { decline_absorbed_stream } from "../../domain/recurring/absorb.service";
import { build_review_item_id, resolve_review_item } from "../../domain/recurring/review_item.service";
import { enqueue_reassign_user } from "../transactions/reassign_user.orchestrator";

export type UndoInput =
  | { kind: "outflow" | "inflow"; mode: "merge"; record_id: string }
  | { kind: "outflow" | "inflow"; mode: "absorb"; record_id: string; stream_id: string };

export async function undo_recurring_merge_orchestrator(
  ctx: TraceContext,
  user_id: string,
  input: UndoInput,
  now_ms: number
): Promise<{ record_id: string; mode: string; no_op: boolean }> {
  const span = create_span(ctx, "orchestrator", "undo_recurring_merge");
  log_operation_start(span, user_id);
  try {
    if (!(await is_convert_to_recurring_enabled(user_id))) throw new ConvertRefusedError("FEATURE_OFF", "Undo isn't available on this account yet");
    if (await is_user_purging(user_id)) throw new ConvertRefusedError("PURGING", "This account is being erased");
    const repo = input.kind === "outflow" ? outflow_repo : inflow_repo;
    const record = await repo.get_by_id(ctx, input.record_id, { include_deleted: true });
    if (!record) throw new NotFoundError(input.kind, input.record_id);
    if (record.user_id !== user_id) throw new PermissionDeniedError("undo_recurring_merge", input.record_id);
    const run_id = `undo_${ctx.trace_id}`;

    if (input.mode === "absorb") {
      const next = decline_absorbed_stream(record.absorbed_streams ?? [], input.stream_id, now_ms);
      if (!next) return { record_id: input.record_id, mode: "absorb", no_op: true };
      await repo.record_absorbed(ctx, input.record_id, next.streams, next.txn_ids, run_id);
      await bump_derive_version(user_id).catch(() => {});
      log_operation_success(span, user_id);
      return { record_id: input.record_id, mode: "absorb", no_op: false };
    }

    const log = record.merge_log;
    if (!record.merged_into_id || !log) return { record_id: input.record_id, mode: "merge", no_op: true };
    // The merge target: owner-checked when it exists; a deleted one is fine.
    const target = await repo.get_by_id(ctx, log.into, { include_deleted: true });
    if (target && target.user_id !== user_id) throw new PermissionDeniedError("undo_recurring_merge", log.into);
    const plan = plan_undo_merge(log, target ? {
      user_custom_name: target.user_custom_name, expected_amount_override: target.expected_amount_override,
    } : null);
    await repo.clear_merge(ctx, input.record_id, plan.restore_intervals, run_id);
    await repo.apply_period_suppression(ctx, input.record_id, plan.restore_intervals, user_id);
    if (target && (plan.revert_target_name || plan.revert_target_override)) {
      await repo.revert_inherited(ctx, target.id, { name: plan.revert_target_name, override: plan.revert_target_override }, run_id);
    }
    // The "same bill?" question (keyed by the new stream) goes back to "keep separate".
    const item_id = build_review_item_id(user_id, "same_bill", log.into);
    const item = (await recurring_review_repo.get_items_by_ids(ctx, [item_id])).get(item_id);
    if (item && item.status === "resolved" && item.answer === "same_bill") {
      await recurring_review_repo.upsert_items(ctx, [resolve_review_item(item, "keep_separate", now_ms)]);
    }
    await enqueue_reassign_user({
      user_id, reason: "recurring_removal",
      scope: { ...(record.account_id ? { account_ids: [record.account_id] } : {}) },
    }, ctx.trace_id).catch((e) => console.error(`[${ctx.trace_id}] undo re-assign enqueue failed:`, e));
    await bump_derive_version(user_id).catch(() => {});
    log_operation_success(span, user_id);
    return { record_id: input.record_id, mode: "merge", no_op: false };
  } catch (error) {
    log_operation_error(span, error instanceof Error ? error : new Error(String(error)), { user_id });
    throw error;
  }
}
