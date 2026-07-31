/**
 * Purge User Data Orchestrator
 *
 * The job handler for a full, permanent user erase. Runs async (enqueued as a
 * `purge_user_data` job) so a large user (1000s of txns) can't time out a
 * callable. Order:
 *
 *   guard (status → running)
 *   → cancel the user's pending jobs
 *   → re-check owned shared groups (defensive) — block if any
 *   → collect parent ids (budgets/inflows/outflows/plaid_items)
 *   → revoke Plaid access tokens (/item/remove) BEFORE deleting plaid_items
 *   → hard-delete child collections (by parent id)
 *   → hard-delete top-level user-keyed collections
 *   → delete sole-owned groups
 *   → delete users/{uid} doc
 *   → delete the Firebase Auth user
 *   → status → done
 *
 * Idempotent: every delete is "remove what matches", so a retry after a partial
 * failure simply finds less to do. The `purge_status/{uid}` doc doubles as the
 * guard read (`is_user_purging`) that Plaid sync/webhook paths honor.
 *
 * @module orchestrators/users/purge_user_data
 */
import { TraceContext } from "../../types";
/** Job payload for the purge. */
export interface PurgeUserDataInput {
    /** The user being erased. */
    user_id: string;
    /** Who initiated (self uid or an admin uid) — for the status doc. */
    initiated_by: string;
    /** This purge job's id, so cancelling the user's pending jobs skips itself. */
    job_id?: string;
    /** Trace id from the enqueuing entry. */
    trace_id: string;
}
export interface PurgeUserDataResult {
    success: boolean;
    blocked: boolean;
    counts: Record<string, number>;
    auth_delete_pending: boolean;
}
export declare function purge_user_data_orchestrator(ctx: TraceContext, input: PurgeUserDataInput): Promise<PurgeUserDataResult>;
//# sourceMappingURL=purge_user_data.orchestrator.d.ts.map