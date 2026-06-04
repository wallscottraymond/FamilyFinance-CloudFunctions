/**
 * Restore Account Orchestrator
 *
 * Coordinates restoring a soft-deleted account.
 * Only accounts that were single-account removals (item still active) can be restored.
 *
 * @module orchestrators/accounts/restore_account
 */
import { TraceContext } from "../../types";
/**
 * Input for restore account operation.
 */
export interface RestoreAccountInput {
    /** Account ID to restore */
    account_id: string;
    /** Idempotency key for deduplication */
    idempotency_key: string;
    /** Whether to also restore hidden transactions */
    restore_transactions: boolean;
    /** Whether to also restore recurring items */
    restore_recurring: boolean;
}
/**
 * Result of restore account operation.
 */
export interface RestoreAccountResult {
    /** Whether the account was restored */
    success: boolean;
    /** The restored account ID */
    account_id: string;
    /** Whether this was an idempotent return */
    was_idempotent: boolean;
    /** Whether restore jobs were enqueued */
    restore_jobs_enqueued: boolean;
}
/**
 * Orchestrates restoring a soft-deleted account.
 *
 * Flow:
 * 1. Idempotency check
 * 2. Repository read (get account)
 * 3. Domain service (permission + restore validation)
 * 4. Repository write (restore account)
 * 5. Enqueue restore jobs (if requested)
 * 6. Emit domain event
 *
 * @param ctx - Trace context
 * @param user_id - User performing the restore
 * @param input - Restore account input
 * @param user_group_ids - User's group memberships
 * @returns Restore result
 */
export declare function restore_account_orchestrator(ctx: TraceContext, user_id: string, input: RestoreAccountInput, user_group_ids?: string[]): Promise<RestoreAccountResult>;
//# sourceMappingURL=restore_account.orchestrator.d.ts.map