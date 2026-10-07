/**
 * Retry Pending Item Removals Orchestrator
 *
 * When an account removal's Plaid `itemRemove` failed, the item stays connected
 * at Plaid (and billed) and is flagged `removalPending`. This retries the
 * removal and, on success, soft-deletes the item. Runs from the 4h scheduled job.
 *
 * @module orchestrators/plaid/retry_pending_item_removals
 */
import { TraceContext } from "../../types";
/** Counts for one retry pass. */
export interface RetryPendingItemRemovalsResult {
    attempted: number;
    removed: number;
    still_pending: number;
}
/**
 * Retries Plaid removal for every flagged item.
 *
 * @param ctx - Trace context
 * @returns Counts for the run
 */
export declare function retry_pending_item_removals_orchestrator(ctx: TraceContext): Promise<RetryPendingItemRemovalsResult>;
//# sourceMappingURL=retry_pending_item_removals.orchestrator.d.ts.map