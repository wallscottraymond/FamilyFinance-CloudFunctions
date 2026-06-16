/**
 * Restore Account Recurring Orchestrator
 *
 * Job handler that restores soft-deleted recurring items for a restored account.
 * Sets `isActive: true` on outflows and inflows linked to the account.
 *
 * @module orchestrators/accounts/restore_account_recurring
 */
import { TraceContext } from "../../types";
/**
 * Input for restore account recurring job.
 */
export interface RestoreAccountRecurringInput {
    /** Plaid account ID to restore recurring items for */
    plaid_account_id: string;
    /** User ID who owns the account */
    user_id: string;
    /** Trace ID from the parent operation */
    trace_id: string;
}
/**
 * Result of restore account recurring job.
 */
export interface RestoreAccountRecurringResult {
    /** Whether the job completed successfully */
    success: boolean;
    /** Number of outflows restored */
    outflows_restored: number;
    /** Number of inflows restored */
    inflows_restored: number;
    /** Number of outflow periods restored */
    outflow_periods_restored: number;
    /** Number of inflow periods restored */
    inflow_periods_restored: number;
}
/**
 * Orchestrates restoring recurring items for a restored account.
 *
 * This is a job handler - called by the job queue processor.
 *
 * Flow:
 * 1. Get soft-deleted outflows for the account
 * 2. Get soft-deleted inflows for the account
 * 3. Batch update to restore them (isActive: true)
 *
 * @param ctx - Trace context (from job payload)
 * @param input - Job input
 * @returns Restore result
 */
export declare function restore_account_recurring_orchestrator(ctx: TraceContext, input: RestoreAccountRecurringInput): Promise<RestoreAccountRecurringResult>;
//# sourceMappingURL=restore_account_recurring.orchestrator.d.ts.map