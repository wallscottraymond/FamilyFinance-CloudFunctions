/**
 * Get Accounts Entry Point
 *
 * Cloud Function entry for retrieving user accounts.
 * Read-only operation - returns all accounts for the authenticated user.
 *
 * @module entry/callable/get_accounts
 */
import { FunctionResponse } from "../../types";
/**
 * Response data for get_accounts.
 * Entry layer DTO - decoupled from repository types.
 */
interface GetAccountsResponseData {
    accounts: AccountResponseData[];
    count: number;
}
/**
 * Account data as returned to client.
 * Entry layer DTO - maps from internal format to client format.
 */
interface AccountResponseData {
    id: string;
    account_id: string;
    item_id: string;
    name: string;
    mask?: string;
    official_name?: string;
    account_type: string;
    account_subtype: string;
    balances: {
        current: number;
        available?: number;
        limit?: number;
        currency_code?: string;
    };
    institution: {
        id: string;
        name: string;
        logo?: string;
    };
    is_sync_enabled: boolean;
}
/**
 * Get all accounts for the authenticated user.
 *
 * @param request.data.include_inactive - Include deleted accounts
 * @param request.data.debug_mode - Enable verbose logging
 * @returns User's accounts
 */
export declare const get_accounts: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<GetAccountsResponseData>>, unknown>;
/**
 * Get a single account by ID.
 *
 * @param request.data.account_id - Account ID to retrieve
 * @param request.data.debug_mode - Enable verbose logging
 * @returns The account or null if not found/unauthorized
 */
export declare const get_account: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<AccountResponseData | null>>, unknown>;
export {};
//# sourceMappingURL=get_accounts.entry.d.ts.map