"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CATEGORY_FANOUT_JOB = void 0;
exports.request_category_reassign = request_category_reassign;
exports.category_reassign_fanout_orchestrator = category_reassign_fanout_orchestrator;
exports.enqueue_audits = enqueue_audits;
const job_queue_1 = require("../../infrastructure/job_queue");
const user_repo_1 = require("../../repositories/user.repo");
const reassign_run_repo_1 = require("../../repositories/reassign_run.repo");
const reassign_user_orchestrator_1 = require("./reassign_user.orchestrator");
exports.CATEGORY_FANOUT_JOB = "category_reassign_fanout";
/** Past the category repo's 5-minute module cache on every instance. */
const CATEGORY_FANOUT_DELAY_SECONDS = 6 * 60;
/** A category doc's mapping changed: schedule the ONE fan-out for this burst (atomic claim). */
async function request_category_reassign(ctx) {
    if (!(await reassign_run_repo_1.reassign_run_repo.claim_category_fanout()))
        return false; // one already pending
    await (0, job_queue_1.create_job)(exports.CATEGORY_FANOUT_JOB, {}, {
        trace_id: ctx.trace_id,
        delay_seconds: CATEGORY_FANOUT_DELAY_SECONDS,
    });
    return true;
}
/** The fan-out job: release the claim FIRST (a later edit schedules a new one), then one run per
 *  user. */
async function category_reassign_fanout_orchestrator(ctx) {
    await reassign_run_repo_1.reassign_run_repo.release_category_fanout();
    return enqueue_for_users(ctx, await user_repo_1.user_repo.get_all_ids(ctx), false, "category_collection");
}
/** Dry-run audit runs for the given users (or all). */
async function enqueue_audits(ctx, user_ids) {
    const ids = user_ids === "all" ? await user_repo_1.user_repo.get_all_ids(ctx) : user_ids;
    return enqueue_for_users(ctx, ids, true, "manual");
}
async function enqueue_for_users(ctx, user_ids, dry_run, reason) {
    let queued = 0;
    for (const user_id of user_ids) {
        if (await (0, reassign_user_orchestrator_1.enqueue_reassign_user)({ user_id, reason, dry_run }, ctx.trace_id))
            queued++;
    }
    console.log(`[${ctx.trace_id}] reassign fan-out (${reason}, dry_run=${dry_run}): ${queued}/${user_ids.length}`);
    return queued;
}
//# sourceMappingURL=reassign_fanout.orchestrator.js.map