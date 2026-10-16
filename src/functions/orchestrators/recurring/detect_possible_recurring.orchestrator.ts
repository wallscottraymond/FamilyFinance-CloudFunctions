/**
 * Detect Possible Recurring Orchestrator (Convert-To-Recurring D11 / X12 / X14 / X17 / X19).
 *
 * The "possible bill" detector runs at most once per user per UTC day, flag-on users only, on the
 * transactions the transfer classifier ALREADY loaded for its full scan (X12: no extra transaction
 * read). Two ways in:
 *   1. INLINE — `run_detector_on_scan` is called by `classify_internal_transfers_orchestrator`
 *      after any full scan (the common case: the sync's follow-up pass).
 *   2. JOB — a sync that added transactions creates `_jobs/detect:{uid}:{UTCday}` with `.create()`
 *      (deterministic: the 2nd–Nth sync of the day are no-ops). The job runs a forced classifier
 *      scan, which calls (1). If (1) already ran today, the job costs one state read.
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
import { create_job_with_id } from "../../infrastructure/job_queue";
import { recurring_review_repo } from "../../repositories/recurring_review.repo";
import { resolve_detector_context } from "../../resolvers/recurring/recurring_detector.resolver";
import {
  DetectorTxn,
  detect_candidates,
  detector_items,
} from "../../domain/recurring/recurring_detector.service";
import { apply_review_state_change, utc_day } from "../../domain/recurring/review_item.service";

export const DETECT_POSSIBLE_RECURRING_JOB = "detect_possible_recurring";
/** A sync's detector job waits this long so a burst of webhooks lands first (coalescing). */
export const DETECTOR_JOB_DELAY_SECONDS = 15 * 60;

/** Deterministic once-a-day job id. */
export const detector_job_id = (user_id: string, now_ms: number): string =>
  `detect:${user_id}:${utc_day(now_ms)}`;

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
  const written = await recurring_review_repo.upsert_items(ctx, items);
  const next = apply_review_state_change(state, user_id, { detector_last_run_day: today });
  if (next.changed) await recurring_review_repo.set_state(ctx, next.next);
  console.log(
    `[${ctx.trace_id}] detector ${user_id}: candidates=${found.candidates.length} written=${written}`
  );
  return { ran: true, candidates: found.candidates.length, items_written: written, capped: found.capped };
}

/**
 * After a sync that added transactions (flag on): make sure today's detector job exists. One
 * `.create()` per call; the 2nd…Nth of the day are no-ops (R2 / R3). Non-fatal.
 */
export async function enqueue_detector_job(
  ctx: TraceContext,
  user_id: string,
  now_ms: number
): Promise<boolean> {
  if (!(await is_convert_to_recurring_enabled(user_id))) return false; // R13: flag off → never
  return create_job_with_id(
    detector_job_id(user_id, now_ms),
    DETECT_POSSIBLE_RECURRING_JOB,
    // `user_id` at the payload root: purge cancels pending jobs by payload.user_id (X19).
    { user_id },
    { delay_seconds: DETECTOR_JOB_DELAY_SECONDS, trace_id: ctx.trace_id }
  ).catch((error) => {
    console.error(`[${ctx.trace_id}] detector enqueue failed (non-fatal):`, error);
    return false;
  });
}
