/**
 * `detect_possible_recurring` job handler (Convert-To-Recurring X12) — registered in BOTH job
 * runners (`on_job_created` and the `process_job_queue` sweep; a delayed job only runs on the
 * sweep). Payload `{ user_id }` (purge cancels by it, X19).
 *
 * Cheap when there's nothing to do: purging / flag off → stop; already ran today → one state read.
 * Otherwise it runs a forced transfer-classifier scan, and the detector rides that scan.
 *
 * @module orchestrators/recurring/detect_possible_recurring.job
 */

import { TraceContext } from "../../types";
import { is_user_purging } from "../../infrastructure/purge_guard";
import { is_convert_to_recurring_enabled } from "../../infrastructure/feature_flags";
import { recurring_review_repo } from "../../repositories/recurring_review.repo";
import { utc_day } from "../../domain/recurring/review_item.service";
import { classify_internal_transfers_orchestrator } from "../plaid/classify_internal_transfers.orchestrator";

export async function run_detect_possible_recurring_job(
  ctx: TraceContext,
  payload: { user_id?: string }
): Promise<{ ran: boolean; reason?: string }> {
  const user_id = payload?.user_id;
  if (!user_id) return { ran: false, reason: "no_user" };
  if (await is_user_purging(user_id)) return { ran: false, reason: "purging" };
  if (!(await is_convert_to_recurring_enabled(user_id))) return { ran: false, reason: "flag_off" };
  const now_ms = Date.now();
  const state = await recurring_review_repo.get_state(ctx, user_id);
  if (state?.detector_last_run_day === utc_day(now_ms)) return { ran: false, reason: "already_today" };
  await classify_internal_transfers_orchestrator(ctx, user_id, now_ms, { force: true });
  return { ran: true };
}
