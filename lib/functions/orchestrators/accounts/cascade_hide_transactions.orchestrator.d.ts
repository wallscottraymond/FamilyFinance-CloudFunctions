/**
 * Cascade Hide Transactions Orchestrator
 *
 * Job handler that hides all transactions for a removed account.
 * Called asynchronously after account removal.
 *
 * @module orchestrators/accounts/cascade_hide_transactions
 */
import { TraceContext } from "../../types";
import { RemovalMode } from "../../domain";
/**
 * Input for the cascade hide transactions job.
 */
export interface CascadeHideTransactionsInput {
    /** Plaid account ID (used to filter transactions) */
    plaid_account_id: string;
    /** User ID */
    user_id: string;
    /** How to handle history */
    removal_mode: RemovalMode;
    /** Trace ID from parent operation */
    trace_id: string;
}
/**
 * Result of the cascade operation.
 */
export interface CascadeHideTransactionsResult {
    /** Number of transactions hidden */
    transactions_hidden: number;
    /** Whether there are more transactions to process */
    has_more: boolean;
    /** Whether the operation completed successfully */
    success: boolean;
}
/**
 * Orchestrates hiding transactions for a removed account.
 *
 * This is designed to be idempotent - running multiple times
 * with the same input will produce the same result.
 *
 * @param ctx - Trace context
 * @param input - Job input
 * @returns Result with count of hidden transactions
 */
export declare function cascade_hide_transactions_orchestrator(ctx: TraceContext, input: CascadeHideTransactionsInput): Promise<CascadeHideTransactionsResult>;
//# sourceMappingURL=cascade_hide_transactions.orchestrator.d.ts.map