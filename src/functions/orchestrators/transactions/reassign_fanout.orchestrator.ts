/**
 * Re-assign fan-outs — "re-assign every user" requests, each turned into one bounded run per user
 * (reassign_user, single-flight per user + scope).
 *
 *   - category mapping changed (canon O1): ONE fan-out per burst of `categories` edits (a bulk
 *     upload writes ~100 docs → still one), delayed past the 5-minute category cache;
 *   - the stored == derived audit (3-A): a dry run per user.
 *
 * @module orchestrators/transactions/reassign_fanout
 */

import { TraceContext } from "../../types";
import { create_job } from "../../infrastructure/job_queue";
import { user_repo } from "../../repositories/user.repo";
import { reassign_run_repo } from "../../repositories/reassign_run.repo";
import { enqueue_reassign_user } from "./reassign_user.orchestrator";

export const CATEGORY_FANOUT_JOB = "category_reassign_fanout";
/** Past the category repo's 5-minute module cache on every instance. */
const CATEGORY_FANOUT_DELAY_SECONDS = 6 * 60;

/** A category doc's mapping changed: schedule the ONE fan-out for this burst (atomic claim). */
export async function request_category_reassign(ctx: TraceContext): Promise<boolean> {
  if (!(await reassign_run_repo.claim_category_fanout())) return false; // one already pending
  await create_job(CATEGORY_FANOUT_JOB, {}, {
    trace_id: ctx.trace_id,
    delay_seconds: CATEGORY_FANOUT_DELAY_SECONDS,
  });
  return true;
}

/** The fan-out job: release the claim FIRST (a later edit schedules a new one), then one run per
 *  user. */
export async function category_reassign_fanout_orchestrator(ctx: TraceContext): Promise<number> {
  await reassign_run_repo.release_category_fanout();
  return enqueue_for_users(ctx, await user_repo.get_all_ids(ctx), false, "category_collection");
}

/** Dry-run audit runs for the given users (or all). */
export async function enqueue_audits(ctx: TraceContext, user_ids: string[] | "all"): Promise<number> {
  const ids = user_ids === "all" ? await user_repo.get_all_ids(ctx) : user_ids;
  return enqueue_for_users(ctx, ids, true, "manual");
}

async function enqueue_for_users(
  ctx: TraceContext,
  user_ids: string[],
  dry_run: boolean,
  reason: "category_collection" | "manual"
): Promise<number> {
  let queued = 0;
  for (const user_id of user_ids) {
    if (await enqueue_reassign_user({ user_id, reason, dry_run }, ctx.trace_id)) queued++;
  }
  console.log(`[${ctx.trace_id}] reassign fan-out (${reason}, dry_run=${dry_run}): ${queued}/${user_ids.length}`);
  return queued;
}
