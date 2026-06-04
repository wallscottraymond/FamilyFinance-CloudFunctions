/**
 * Link Plaid Accounts Orchestrator
 *
 * Coordinates the workflow of fetching accounts from Plaid
 * and saving them to Firestore using the new architecture.
 *
 * Flow:
 * 1. Idempotency check
 * 2. Fetch accounts from Plaid (Integration Client)
 * 3. Transform to domain entities (Integration Transformer - PURE)
 * 4. Save to Firestore (Repository)
 * 5. Emit domain events
 *
 * @module orchestrators/accounts/link_plaid_accounts
 */
import { TraceContext } from "../../types";
import { PlaidInstitutionInfo } from "../../integrations/plaid";
/**
 * Input for linking Plaid accounts.
 */
export interface LinkPlaidAccountsInput {
    /** Decrypted Plaid access token */
    access_token: string;
    /** Plaid item ID */
    item_id: string;
    /** Institution information */
    institution: PlaidInstitutionInfo;
    /** Group IDs for sharing (empty = private) */
    group_ids: string[];
    /** Idempotency key for deduplication */
    idempotency_key: string;
}
/**
 * Result of linking Plaid accounts.
 */
export interface LinkPlaidAccountsResult {
    /** Whether the operation succeeded */
    success: boolean;
    /** Number of accounts linked */
    accounts_linked: number;
    /** Account IDs that were created */
    account_ids: string[];
    /** Plaid item ID */
    item_id: string;
    /** Whether this was an idempotent return */
    was_idempotent: boolean;
}
/**
 * Orchestrates linking Plaid accounts to the user's profile.
 *
 * This function:
 * 1. Fetches account data from Plaid API
 * 2. Transforms Plaid data to domain entities
 * 3. Saves accounts to Firestore
 * 4. Emits account created events
 *
 * @param ctx - Trace context
 * @param user_id - User ID to link accounts to
 * @param input - Link accounts input
 * @returns Result with linked account info
 */
export declare function link_plaid_accounts_orchestrator(ctx: TraceContext, user_id: string, input: LinkPlaidAccountsInput): Promise<LinkPlaidAccountsResult>;
//# sourceMappingURL=link_plaid_accounts.orchestrator.d.ts.map