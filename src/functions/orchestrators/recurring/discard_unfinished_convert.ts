/**
 * Supersede a conversion the user REMOVED before it finished (the way out of CONVERT_FAILED).
 *
 * The same steps as a normal delete of a bill, then the caller converts afresh:
 *   1. claim (a live lease or a finished record is left alone; two simultaneous taps can't both),
 *   2. `handle_converted_delete` (un-merge what merged into it, remember what it absorbed),
 *   3. re-assign every transaction still pointing at it, plus the source (stamped, collected) so
 *      the old links clear and the follow-up pass recomputes their budgets,
 *   4. delete its periods, then the record,
 *   5. ONE follow-up pass and the derive bump (in `finally`).
 *
 * @module orchestrators/recurring/discard_unfinished_convert
 */

import { TraceContext } from "../../types";
import { convert_recurring_repo } from "../../repositories/convert_recurring.repo";
import { bump_derive_version } from "../../repositories/derive_version.repo";
import type { SyncWrittenDoc } from "../../repositories/transaction.repo";
import type { ConvertDirection } from "../../domain/recurring/convert_recurring.service";
import { handle_converted_delete } from "./converted_delete";
import { inflow_repo, outflow_repo } from "../../repositories";
import { recurring_review_repo } from "../../repositories/recurring_review.repo";
import { suggested_subject } from "../../domain/recurring/review_item.service";
import { assign_transactions_batch_orchestrator } from "../transactions/assign_transactions_batch.orchestrator";
import { follow_ups_from_written, run_sync_follow_ups } from "../plaid/sync_follow_ups";
import { randomUUID } from "crypto";

export type DiscardOutcome = "discarded" | "in_progress" | "not_discardable";

export async function discard_unfinished_convert(
  ctx: TraceContext,
  user_id: string,
  direction: ConvertDirection,
  id: string,
  source_doc_id: string,
  now_ms: number
): Promise<DiscardOutcome> {
  const claim = await convert_recurring_repo.claim_discard(ctx, direction, id, now_ms);
  if (claim === "gone") return "discarded"; // a simultaneous tap already did it
  if (claim === "in_progress") return "in_progress";
  if (claim === "finished") return "not_discardable";

  let touched = false;
  const written: SyncWrittenDoc[] = [];
  const repo = direction === "outflow" ? outflow_repo : inflow_repo;
  try {
    touched = true;
    const record = await repo.get_by_id(ctx, id, { include_deleted: true });
    await handle_converted_delete(ctx, user_id, direction, id);
    // The delete remembers the streams the record absorbed as declined ("Not a bill" + held-out
    // payments). This record is being replaced by a fresh convert of the SAME direction and account,
    // which owns those payments again: forget exactly what that delete added.
    const absorbed = (record?.absorbed_streams ?? []).filter((x) => x.state === "absorbed");
    if (record && absorbed.length > 0) {
      const vendors = [...new Set([record.vendor_key, ...absorbed.map((a) => a.vendor_key)].filter((v): v is string => !!v))];
      await recurring_review_repo.apply_state_change(ctx, user_id, {
        remove_dismissed_vendor_keys: vendors.map((v) => suggested_subject(direction, v)),
        remove_suppressed: record.absorbed_txn_ids ?? [],
      });
    }
    const ids = [...new Set([...(await convert_recurring_repo.linked_txn_ids(ctx, direction, id)), source_doc_id])];
    let assign_error: unknown = null;
    try {
      // The record is hidden (claim), so the engine can't re-link to it and pins fall back to auto.
      await assign_transactions_batch_orchestrator(ctx, {
        user_id, transaction_ids: ids, run_id: `discard_${randomUUID()}`, collect_into: written,
      });
    } catch (e) {
      assign_error = e; // still recompute what it wrote, then surface the failure
    }
    if (assign_error === null) await convert_recurring_repo.delete_record_and_periods(ctx, direction, id, user_id);
    if (written.length > 0) {
      const f = follow_ups_from_written(written);
      await run_sync_follow_ups(ctx, user_id, {
        ...f, transactions_changed: true, recurring_changed: false, transfers_changed: false,
      }, { preload_budget_window: true }).catch((e) => console.error(`[${ctx.trace_id}] discard follow-ups failed:`, e));
    }
    if (assign_error !== null) throw assign_error; // the record stays (hidden, leased): a later tap retries
    return "discarded";
  } finally {
    if (touched) await bump_derive_version(user_id).catch(() => {});
  }
}
