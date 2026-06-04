/**
 * Plaid Integration Client
 *
 * Handles Plaid API calls with retry logic and error handling.
 * This is the ONLY place that makes direct Plaid API calls.
 *
 * @module integrations/plaid/plaid_client
 */
import { LinkTokenCreateResponse, ItemPublicTokenExchangeResponse, TransactionsSyncResponse, TransactionsRecurringGetResponse } from "plaid";
import { PlaidCreateLinkTokenInput } from "../../types/plaid";
/**
 * Raw account data from Plaid API.
 */
export interface PlaidAccountData {
    account_id: string;
    name: string;
    official_name: string | null;
    type: string;
    subtype: string | null;
    mask: string | null;
    balances: {
        current: number | null;
        available: number | null;
        limit: number | null;
        iso_currency_code: string | null;
    };
}
/**
 * Result of fetching accounts from Plaid.
 */
export interface PlaidAccountsResult {
    accounts: PlaidAccountData[];
    item_id: string;
    request_id: string;
}
/**
 * Institution information from Plaid.
 */
export interface PlaidInstitutionInfo {
    institution_id: string;
    name: string;
}
/**
 * Fetches accounts from Plaid for a given access token.
 *
 * @param access_token - Decrypted Plaid access token
 * @returns Account data from Plaid
 */
export declare function fetch_plaid_accounts(access_token: string): Promise<PlaidAccountsResult>;
/**
 * Fetches account balances from Plaid (for balance refresh).
 *
 * @param access_token - Decrypted Plaid access token
 * @param account_ids - Optional specific account IDs to fetch
 * @returns Account data with fresh balances
 */
export declare function fetch_plaid_balances(access_token: string, account_ids?: string[]): Promise<PlaidAccountsResult>;
/**
 * Creates a Plaid Link token for initializing Plaid Link.
 *
 * Returns the RAW Plaid SDK response (LinkTokenCreateResponse).
 * Transformation to domain format is done by the transformer.
 *
 * @param input - User and configuration data
 * @returns Raw Plaid LinkTokenCreateResponse
 */
export declare function create_link_token(input: PlaidCreateLinkTokenInput): Promise<LinkTokenCreateResponse>;
/**
 * Exchanges a public token for an access token.
 *
 * Called after user completes Plaid Link. Returns RAW Plaid SDK response.
 * The access_token in the response should be encrypted before storage.
 *
 * @param public_token - The public token from Plaid Link
 * @returns Raw Plaid ItemPublicTokenExchangeResponse
 */
export declare function exchange_public_token(public_token: string): Promise<ItemPublicTokenExchangeResponse>;
/**
 * Syncs transactions from Plaid using the /transactions/sync endpoint.
 *
 * Returns the RAW Plaid SDK response (TransactionsSyncResponse).
 * The response includes:
 * - added: New transactions since last cursor
 * - modified: Transactions that were updated
 * - removed: Transaction IDs that were removed
 * - next_cursor: Cursor for next sync
 * - has_more: Whether there are more pages
 *
 * @param access_token - Decrypted Plaid access token
 * @param cursor - Optional cursor from previous sync (null for initial)
 * @param count - Number of transactions per page (max 500)
 * @returns Raw Plaid TransactionsSyncResponse
 */
export declare function sync_transactions(access_token: string, cursor?: string | null, count?: number): Promise<TransactionsSyncResponse>;
/**
 * Fetches recurring transactions from Plaid.
 *
 * Returns the RAW Plaid SDK response (TransactionsRecurringGetResponse).
 * The response includes:
 * - inflow_streams: Recurring income (positive amounts)
 * - outflow_streams: Recurring expenses (negative amounts)
 * - updated_datetime: When Plaid last updated this data
 * - request_id: Plaid request ID for debugging
 *
 * @param access_token - Decrypted Plaid access token
 * @param account_ids - Optional specific account IDs to fetch recurring for
 * @returns Raw Plaid TransactionsRecurringGetResponse
 */
export declare function fetch_recurring_transactions(access_token: string, account_ids?: string[]): Promise<TransactionsRecurringGetResponse>;
/**
 * Result of removing a Plaid item.
 */
export interface RemoveItemResult {
    /** Whether the removal was successful */
    success: boolean;
    /** Plaid request ID for debugging */
    request_id: string;
    /** Whether the item was already removed (idempotent case) */
    already_removed: boolean;
}
/**
 * Removes a Plaid item (disconnects the institution link).
 *
 * This removes the ENTIRE item, which includes ALL accounts linked
 * to that institution. There is no Plaid API to remove a single account.
 *
 * After calling this:
 * - The access_token becomes invalid
 * - No more webhooks will be sent for this item
 * - All accounts under this item should be soft-deleted locally
 *
 * This operation is idempotent - if the item is already removed,
 * returns success with already_removed=true.
 *
 * @param access_token - Decrypted Plaid access token
 * @returns Result indicating success/failure
 */
export declare function remove_item(access_token: string): Promise<RemoveItemResult>;
//# sourceMappingURL=plaid_client.d.ts.map