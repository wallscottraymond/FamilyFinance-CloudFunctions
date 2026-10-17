/**
 * Deleting a bill / income that others depend on (Convert-To-Recurring review item 9, P9, P10).
 *
 *   - Records MERGED INTO it (a same-bill merge or a convert over an old bill) are un-merged first:
 *     their intervals come back, so a hard delete never strands an old bill with a dangling
 *     `mergedIntoId` (hidden from Removed, no Restore, no undo target).
 *   - Plaid streams IT ABSORBED are remembered as declined: their vendor is written as "Not a bill"
 *     and their payments are held out of fuzzy matching, so the next sync never brings them back as
 *     a new Plaid bill (deleting the last converted bill would otherwise turn the absorber off and
 *     let the stream be saved).
 * Nothing happens for a record with neither (the common case: one query).
 *
 * @module orchestrators/recurring/converted_delete
 */

import { TraceContext } from "../../types";
import { inflow_repo, outflow_repo } from "../../repositories";
import { recurring_review_repo } from "../../repositories/recurring_review.repo";
import { plaid_item_repo } from "../../repositories/plaid/plaid_item.repo";
import { bump_derive_version } from "../../repositories/derive_version.repo";
import { suggested_subject } from "../../domain/recurring/review_item.service";
import { enqueue_reassign_user } from "../transactions/reassign_user.orchestrator";

export async function handle_converted_delete(
  ctx: TraceContext,
  user_id: string,
  kind: "outflow" | "inflow",
  id: string
): Promise<void> {
  const repo = kind === "outflow" ? outflow_repo : inflow_repo;
  const record = await repo.get_by_id(ctx, id, { include_deleted: true });
  if (!record || record.user_id !== user_id) return;
  const run_id = `delete_${ctx.trace_id}`;
  let changed = false;

  for (const m of await repo.get_merged_into(ctx, user_id, id)) {
    const old = await repo.get_by_id(ctx, m.id, { include_deleted: true });
    const intervals = old?.merge_log?.prior_intervals;
    if (!old || !intervals) continue;
    await repo.clear_merge(ctx, old.id, intervals, run_id, old.merge_log?.prior_is_active);
    await repo.apply_period_suppression(ctx, old.id, intervals, user_id);
    await enqueue_reassign_user({
      user_id, reason: "recurring_removal",
      scope: { ...(old.account_id ? { account_ids: [old.account_id] } : {}) },
    }, ctx.trace_id).catch((e) => console.error(`[${ctx.trace_id}] unmerge re-assign enqueue failed:`, e));
    changed = true;
  }

  const absorbed = (record.absorbed_streams ?? []).filter((s) => s.state === "absorbed");
  if (absorbed.length > 0) {
    // Its own vendor AND each absorbed stream's (they can differ): none may return as a new bill.
    const vendors = [...new Set([record.vendor_key, ...absorbed.map((a) => a.vendor_key)].filter((v): v is string => !!v))];
    await recurring_review_repo.apply_state_change(ctx, user_id, {
      add_dismissed_vendor_keys: vendors.map((v) => suggested_subject(kind, v)),
      add_suppressed: record.absorbed_txn_ids ?? [],
    });
    changed = true;
    // The sync already reads its Plaid item: mark them so the planner (which honours this memory)
    // still runs when no other v2 record is left and the flag is off (C).
    await plaid_item_repo.set_review_memory(ctx, await plaid_item_repo.get_active_doc_ids_by_user(ctx, user_id));
  }
  if (changed) await bump_derive_version(user_id).catch(() => {});
}
