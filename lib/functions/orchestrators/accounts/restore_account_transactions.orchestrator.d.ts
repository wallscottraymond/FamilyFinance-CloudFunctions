/**
 * Restore Account Transactions Orchestrator
 *
 * Job handler that unhides transactions for a restored account.
 * Sets `isHidden: false` on all transactions for the account.
 *
 * @module orchestrators/accounts/restore_account_transactions
 */
import { TraceContext } from "../../types";
/**
 * Input for restore account transactions job.
 */
export interface RestoreAccountTransactionsInput {
    /** Plaid account ID to restore transactions for */
    plaid_account_id: string;
    /** User ID who owns the account */
    user_id: string;
    /** Trace ID from the parent operation */
    trace_id: string;
}
/**
 * Result of restore account transactions job.
 */
export interface RestoreAccountTransactionsResult {
    /** Whether the job completed successfully */
    success: boolean;
    /** Number of transactions restored (unhidden) */
    transactions_restored: number;
}
/**
 * Orchestrates restoring (unhiding) transactions for a restored account.
 *
 * This is a job handler - called by the job queue processor.
 *
 * Flow:
 * 1. Get hidden transaction IDs for the account
 * 2. Batch update to set isHidden: false
 *
 * @param ctx - Trace context (from job payload)
 * @param input - Job input
 * @returns Restore result
 */
export declare function restore_account_transactions_orchestrator(ctx: TraceContext, input: RestoreAccountTransactionsInput): Promise<RestoreAccountTransactionsResult>;
//# sourceMappingURL=restore_account_transactions.orchestrator.d.ts.map