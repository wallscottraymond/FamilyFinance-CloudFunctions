/**
 * Cascade Soft Delete Recurring Orchestrator
 *
 * Job handler that soft-deletes all recurring outflows and inflows
 * for a removed account.
 *
 * @module orchestrators/accounts/cascade_soft_delete_recurring
 */
import { TraceContext } from "../../types";
/**
 * Input for the cascade soft delete recurring job.
 */
export interface CascadeSoftDeleteRecurringInput {
    /** Plaid account ID */
    plaid_account_id: string;
    /** User ID */
    user_id: string;
    /** IDs of outflows to soft-delete */
    outflow_ids: string[];
    /** IDs of inflows to soft-delete */
    inflow_ids: string[];
    /** Trace ID from parent operation */
    trace_id: string;
}
/**
 * Result of the cascade operation.
 */
export interface CascadeSoftDeleteRecurringResult {
    /** Number of outflows soft-deleted */
    outflows_deleted: number;
    /** Number of inflows soft-deleted */
    inflows_deleted: number;
    /** Whether the operation completed successfully */
    success: boolean;
}
/**
 * Orchestrates soft-deleting recurring items for a removed account.
 *
 * This is designed to be idempotent - running multiple times
 * with the same input will produce the same result.
 *
 * @param ctx - Trace context
 * @param input - Job input
 * @returns Result with counts
 */
export declare function cascade_soft_delete_recurring_orchestrator(ctx: TraceContext, input: CascadeSoftDeleteRecurringInput): Promise<CascadeSoftDeleteRecurringResult>;
//# sourceMappingURL=cascade_soft_delete_recurring.orchestrator.d.ts.map