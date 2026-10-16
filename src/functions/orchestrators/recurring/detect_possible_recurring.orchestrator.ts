/**
 * Detect Possible Recurring Orchestrator (Convert-To-Recurring D11 / X12 / X14 / X17 / X19).
 *
 * The "possible bill" detector runs at most once per user per UTC day, flag-on users only, on the
 * transactions the transfer classifier ALREADY loaded for its full scan (X12: no extra transaction
 * read). ONE way in: `run_detector_on_scan` is called by `classify_internal_transfers_orchestrator`
 * after any full scan it was going to do anyway. There is deliberately NO fallback job: a job
 * that forces a classifier scan would cost a full transaction read (X12 says zero extra reads).
 * A day without a full scan simply has no detector run; the throttle (detector day in the review
 * state doc) keeps it to at most once per UTC day.
 *
 * Writes: suggested review items (only new / changed ones) + the state's detector day. Never a
 * dismissed vendor (R11), never a bill record, never a derive bump (detector items don't feed the
 * derive). Checks `is_user_purging` before writing (X19).
 *
 * @module orchestrators/recurring/detect_possible_recurring
 */

import { TraceContext } from "../../types";
import { is_user_purging } from "../../infrastructure/purge_guard";
import { is_convert_to_recurring_enabled } from "../../infrastructure/feature_flags";
import { recurring_review_repo } from "../../repositories/recurring_review.repo";
import { resolve_detector_context } from "../../resolvers/recurring/recurring_detector.resolver";
import {
  DetectorTxn,
  detect_candidates,
  detector_items,
} from "../../domain/recurring/recurring_detector.service";
import { apply_review_state_change, utc_day } from "../../domain/recurring/review_item.service";

export interface DetectorScan {
  txns: DetectorTxn[];
  internal_txn_ids: Set<string>;
  /** The active records the classifier loaded (ids + stream ids + vendor fields). */
  records: Array<{
    kind: "outflow" | "inflow";
    transaction_ids: string[];
    merchant_name: string | null;
    description: string | null;
  }>;
}

export interface DetectorRunResult {
  ran: boolean;
  reason?: "flag_off" | "already_today" | "purging";
  candidates: number;
  items_written: number;
  capped: boolean;
}

/** Run the detector on a classifier scan (inline path). Non-throwing callers wrap it. */
export async function run_detector_on_scan(
  ctx: TraceContext,
  user_id: string,
  now_ms: number,
  scan: DetectorScan
): Promise<DetectorRunResult> {
  const none = (reason: DetectorRunResult["reason"]): DetectorRunResult =>
    ({ ran: false, reason, candidates: 0, items_written: 0, capped: false });
  if (!(await is_convert_to_recurring_enabled(user_id))) return none("flag_off");

  // 1. State (1 read) — the daily throttle + held-out ids + "Not a bill" vendors.
  const state = await recurring_review_repo.get_state(ctx, user_id);
  const today = utc_day(now_ms);
  if (state?.detector_last_run_day === today) return none("already_today");

  // 2. Everything else it needs, read-only (inactive records' stream ids; item lookups by id).
  const base = await resolve_detector_context(ctx, user_id, scan);
  let found = detect_candidates({
    user_id, now_ms, txns: scan.txns, internal_txn_ids: scan.internal_txn_ids,
    record_txn_ids: base.record_txn_ids, record_vendor_subjects: base.record_vendor_subjects,
    state, account_types: null,
  });
  if (found.needs_account_types) {
    found = detect_candidates({
      user_id, now_ms, txns: scan.txns, internal_txn_ids: scan.internal_txn_ids,
      record_txn_ids: base.record_txn_ids, record_vendor_subjects: base.record_vendor_subjects,
      state, account_types: await base.load_account_types(),
    });
  }
  if (found.capped) {
    console.warn(`[${ctx.trace_id}] detector: ${scan.txns.length} txns > cap — the most recent were used (user ${user_id})`);
  }
  const existing = await base.load_items(found.candidates.map((c) => c.item_id));
  const items = detector_items(user_id, now_ms, found.candidates, existing);

  // 3. Persist (never into a user being erased).
  if (await is_user_purging(user_id)) return none("purging");
  // Guarded (defect 1): never reverts an item the user answered while the detector ran.
  const written = (await recurring_review_repo.write_items_guarded(ctx, user_id, items, existing)).written;
  if (apply_review_state_change(state, user_id, { detector_last_run_day: today }).changed) {
    // Atomic against the fresh doc (a concurrent "Not a bill" / sync write is never lost).
    await recurring_review_repo.apply_state_change(ctx, user_id, { detector_last_run_day: today });
  }
  console.log(
    `[${ctx.trace_id}] detector ${user_id}: candidates=${found.candidates.length} written=${written}`
  );
  return { ran: true, candidates: found.candidates.length, items_written: written, capped: found.capped };
}
