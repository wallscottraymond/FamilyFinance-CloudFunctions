/**
 * Manage Outflow Removal Orchestrator
 *
 * Coordinates the user actions for the Remove-Recover-Recurring feature on a
 * recurring outflow: remove (all / going-forward), pause (until a date), restore
 * (forward-only resume), and permanent delete. Loads the current removal state
 * (resolver), authorizes, applies the pure suppression transition (domain), and
 * persists (repo). Suppression itself is derived on read elsewhere — this only
 * mutates the stored `removal_intervals`.
 *
 * @module orchestrators/recurring/manage_outflow_removal
 */
import { TraceContext } from "../../types";
import { RemovalState } from "../../domain/recurring/recurring_suppression.service";
export type ManageOutflowRemovalInput = {
    outflow_id: string;
    action: "remove";
    mode: "all" | "going_forward";
} | {
    outflow_id: string;
    action: "pause";
    resume_ms: number;
} | {
    outflow_id: string;
    action: "restore";
} | {
    outflow_id: string;
    action: "delete";
};
export interface ManageOutflowRemovalResult {
    outflow_id: string;
    action: ManageOutflowRemovalInput["action"];
    deleted: boolean;
    /** Resulting state (null for a permanent delete). */
    state: RemovalState | null;
}
export declare function manage_outflow_removal_orchestrator(ctx: TraceContext, user_id: string, user_group_ids: string[], input: ManageOutflowRemovalInput, now_ms: number): Promise<ManageOutflowRemovalResult>;
//# sourceMappingURL=manage_outflow_removal.orchestrator.d.ts.map