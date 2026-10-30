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
export declare const CATEGORY_FANOUT_JOB = "category_reassign_fanout";
/** A category doc's mapping changed: schedule the ONE fan-out for this burst (atomic claim). */
export declare function request_category_reassign(ctx: TraceContext): Promise<boolean>;
/** The fan-out job: release the claim FIRST (a later edit schedules a new one), then one run per
 *  user. */
export declare function category_reassign_fanout_orchestrator(ctx: TraceContext): Promise<number>;
/** Dry-run audit runs for the given users (or all). */
export declare function enqueue_audits(ctx: TraceContext, user_ids: string[] | "all"): Promise<number>;
//# sourceMappingURL=reassign_fanout.orchestrator.d.ts.map