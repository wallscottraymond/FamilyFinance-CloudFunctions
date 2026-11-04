/**
 * Waitlist Repository (Website-Waitlist)
 *
 * - `waitlist/{sha256(email)}`: one person waiting.
 * - `_waitlist_limits/{sha256(day:ip)}`: one network's requests today (TTL on `expire_at`).
 * - `_waitlist_limits/global`: new signups today (kept, overwritten daily).
 *
 * Functions-only: the rules deny every client read and write.
 *
 * @module repositories/waitlist
 */
import { TraceContext } from "../types";
import { JoinState, JoinPlan } from "../domain/waitlist/waitlist.service";
export declare const WAITLIST_COLLECTION = "waitlist";
export declare const WAITLIST_LIMITS_COLLECTION = "_waitlist_limits";
export declare const waitlist_repo: {
    /** Reads the entry and both counters, plans, and writes the plan atomically. */
    join_in_transaction(_ctx: TraceContext, id: string, ip_limit_id: string, plan: (state: JoinState) => JoinPlan): Promise<JoinPlan>;
};
//# sourceMappingURL=waitlist.repo.d.ts.map