/**
 * Assign Split → Income Orchestrator (Convert-To-Recurring Phase 2): pin a deposit's split to one
 * of the caller's incomes, or clear the pin.
 *
 *   flag → resolve facts (read-only) → plan (pure: owner, credit, view) → pin (one Firestore
 *   transaction that re-checks both owners) → bump the derive version AFTER the write.
 *
 * The pin write is unstamped, like the bill pin: `on_transaction_written` re-runs the assignment
 * engine for the transaction and reconciles the touched incomes (1 assign job + reconciles — a
 * user tap, not a fan-out).
 *
 * @module orchestrators/recurring/assign_split_to_inflow
 */
import { TraceContext } from "../../types";
export interface AssignSplitToInflowInput {
    transaction_id: string;
    split_id: string;
    /** The income to pin to; null clears the pin (back to auto-derivation). */
    inflow_id: string | null;
}
export declare function assign_split_to_inflow_orchestrator(ctx: TraceContext, user_id: string, input: AssignSplitToInflowInput): Promise<{
    transaction_id: string;
    split_id: string;
    inflow_id: string | null;
}>;
//# sourceMappingURL=assign_split_to_inflow.orchestrator.d.ts.map