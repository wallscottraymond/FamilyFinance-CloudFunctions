/**
 * Remove Account Orchestrator
 *
 * Coordinates soft-deletion of an account with two-tier removal logic:
 * - Single Account Removal: Local soft-delete only (Plaid item stays active)
 * - Full Item Removal: Call Plaid API + soft-delete (last account for item)
 *
 * Includes idempotency handling, permission checks, cascade job scheduling,
 * and event emission.
 *
 * @module orchestrators/accounts/remove_account
 */
import { TraceContext } from "../../types";
import { RemovalMode } from "../../domain";
/**
 * Input for remove account operation.
 */
export interface RemoveAccountInput {
    /** Account ID to remove */
    account_id: string;
    /** Idempotency key for deduplication */
    idempotency_key: string;
    /**
     * How to handle transaction history.
     * - keep_history: Transactions hidden but still count in budget totals
     * - delete_history: Transactions hidden AND excluded from budget calculations
     */
    removal_mode: RemovalMode;
}
/**
 * Result of remove account operation.
 */
export interface RemoveAccountResult {
    /** Whether the account was removed */
    success: boolean;
    /** The removed account ID */
    account_id: string;
    /** Whether this was an idempotent return (already processed) */
    was_idempotent: boolean;
    /** Whether this was a single account or full item removal */
    removal_type: "single_account" | "full_item";
    /** Number of transactions that will be hidden */
    transaction_count: number;
    /** Number of recurring outflows that will be soft-deleted */
    outflow_count: number;
    /** Number of recurring inflows that will be soft-deleted */
    inflow_count: number;
    /** Whether cascade jobs were enqueued for background processing */
    cascade_jobs_enqueued: boolean;
}
/**
 * Orchestrates soft-deletion of an account with two-tier removal logic.
 *
 * Flow (per architecture):
 * 1. Create span, log start
 * 2. Idempotency check
 * 3. Claim idempotency key
 * 4. Repository read (get account)
 * 5. Domain service (permission check)
 * 6. Resolver (dependency analysis - determines removal type)
 * 7. Domain service (compute removal state)
 * 8. Integration client (Plaid API - only for full item removal)
 * 9. Repository write (soft delete)
 * 10. Complete idempotency key
 * 11. Emit domain event
 * 12. Enqueue cascade jobs (transactions, recurring items)
 * 13. Log success, async debug
 *
 * @param ctx - Trace context
 * @param user_id - User performing the deletion
 * @param input - Remove account input
 * @param user_group_ids - User's group memberships
 * @returns Remove result
 */
export declare function remove_account_orchestrator(ctx: TraceContext, user_id: string, input: RemoveAccountInput, user_group_ids?: string[]): Promise<RemoveAccountResult>;
//# sourceMappingURL=remove_account.orchestrator.d.ts.map