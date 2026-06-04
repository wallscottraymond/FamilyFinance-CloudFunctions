/**
 * Get Accounts Orchestrator
 *
 * Coordinates retrieval of user accounts.
 * This is a read-only operation - no idempotency or events needed.
 *
 * @module orchestrators/accounts/get_accounts
 */
import { TraceContext } from "../../types";
import { Account } from "../../repositories";
/**
 * Input for get accounts operation.
 */
export interface GetAccountsInput {
    /** Include inactive/deleted accounts */
    include_inactive?: boolean;
}
/**
 * Result of get accounts operation.
 */
export interface GetAccountsResult {
    accounts: Account[];
    count: number;
}
/**
 * Orchestrates retrieval of user accounts.
 *
 * Flow:
 * 1. Log start
 * 2. Repository read (no idempotency for reads)
 * 3. Log success
 * 4. Async debug logging
 *
 * @param ctx - Trace context
 * @param user_id - User ID
 * @param input - Optional filters
 * @returns User's accounts
 */
export declare function get_accounts_orchestrator(ctx: TraceContext, user_id: string, input?: GetAccountsInput): Promise<GetAccountsResult>;
/**
 * Gets a single account by ID with permission check.
 *
 * Flow:
 * 1. Log start
 * 2. Repository read
 * 3. Domain service permission check
 * 4. Log success
 *
 * @param ctx - Trace context
 * @param user_id - User ID (for permission check)
 * @param account_id - Account ID
 * @param user_group_ids - User's group memberships (for group access)
 * @returns Account or null if not found/not authorized
 */
export declare function get_account_orchestrator(ctx: TraceContext, user_id: string, account_id: string, user_group_ids?: string[]): Promise<Account | null>;
//# sourceMappingURL=get_accounts.orchestrator.d.ts.map