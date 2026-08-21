/**
 * Manage Recurring Removal Orchestrator (generic over outflow/inflow)
 *
 * Coordinates the Remove-Recover-Recurring actions on a recurring item: remove
 * (all / going-forward), pause (until a date), restore (forward-only resume), and
 * permanent delete. Loads current state (resolver), authorizes, applies the pure
 * suppression transition (domain), and persists (repo). Repo-agnostic so outflows
 * and inflows share it. Suppression itself is derived on read elsewhere.
 *
 * @module orchestrators/recurring/manage_recurring_removal
 */
import { TraceContext, WriteResult } from "../../types";
import { RemovalReadableRepo } from "../../resolvers/recurring/recurring_removal.resolver";
import { RemovalInterval, RemovalState } from "../../domain/recurring/recurring_suppression.service";
/** The write surface a removal-manageable recurring repo must expose. */
export interface RemovalManageableRepo extends RemovalReadableRepo {
    set_removal_intervals(ctx: TraceContext, id: string, intervals: RemovalInterval[], removed_by_user: boolean, user_id: string): Promise<WriteResult>;
    /**
     * Reflect the new suppression intervals onto the item's materialized periods by
     * flipping each period's `isActive` (suppressed → false). This is what drops a
     * removed bill/income out of `user_summaries` (which reads only isActive==true) and
     * thus out of the live list + totals; restore flips them back.
     */
    apply_period_suppression(ctx: TraceContext, id: string, intervals: RemovalInterval[], user_id: string): Promise<number>;
    hard_delete(ctx: TraceContext, id: string, user_id: string): Promise<WriteResult>;
}
export type ManageRecurringRemovalInput = {
    id: string;
    action: "remove";
    mode: "all" | "going_forward";
} | {
    id: string;
    action: "pause";
    resume_ms: number;
} | {
    id: string;
    action: "restore";
} | {
    id: string;
    action: "delete";
};
export interface ManageRecurringRemovalResult {
    id: string;
    action: ManageRecurringRemovalInput["action"];
    deleted: boolean;
    /** Resulting state (null for a permanent delete). */
    state: RemovalState | null;
}
export declare function manage_recurring_removal_orchestrator(ctx: TraceContext, user_id: string, user_group_ids: string[], input: ManageRecurringRemovalInput, now_ms: number, repo: RemovalManageableRepo, entity_kind: "recurring_outflow" | "recurring_inflow"): Promise<ManageRecurringRemovalResult>;
//# sourceMappingURL=manage_recurring_removal.orchestrator.d.ts.map