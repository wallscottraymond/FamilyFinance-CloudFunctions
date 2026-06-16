/**
 * Plaid Transformer
 *
 * PURE functions that convert Plaid data formats to domain formats.
 * NO async, NO IO, NO side effects.
 *
 * @module integrations/plaid/plaid_transformer
 */
import { Timestamp } from "firebase-admin/firestore";
import { AccountBase } from "plaid";
import { DomainResult } from "../../types";
import { PlaidInstitutionInfo } from "./plaid_client";
/**
 * Account data in the snake_case domain-input shape the downstream
 * transformers + `account_repo` consume. Produced by `plaid_accounts_to_data`
 * from the RAW Plaid SDK `AccountBase` (the client never maps).
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
 * PURE: map raw Plaid SDK accounts to the domain-input shape. No IO.
 */
export declare function plaid_accounts_to_data(accounts: AccountBase[]): PlaidAccountData[];
/**
 * Account entity ready for persistence.
 * Matches the structure expected by account_repo.
 */
export interface AccountForPersistence {
    id: string;
    user_id: string;
    group_ids: string[];
    is_active: boolean;
    is_deleted: boolean;
    created_at: Timestamp;
    updated_at: Timestamp;
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
        iso_currency_code?: string;
        last_updated: Timestamp;
    };
    institution: {
        id: string;
        name: string;
        logo?: string;
    };
    is_sync_enabled: boolean;
    last_synced_at?: Timestamp;
    access: {
        owner_id: string;
        created_by: string;
        group_ids: string[];
        is_private: boolean;
    };
}
/**
 * Context for transforming Plaid accounts.
 */
export interface TransformContext {
    user_id: string;
    item_id: string;
    institution: PlaidInstitutionInfo;
    group_ids: string[];
    now: Timestamp;
}
/**
 * Transforms Plaid accounts to domain entities.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param plaid_accounts - Raw accounts from Plaid API
 * @param context - Transformation context
 * @returns Domain result with entities or validation errors
 */
export declare function transform_plaid_accounts_to_domain(plaid_accounts: PlaidAccountData[], context: TransformContext): DomainResult<AccountForPersistence>;
/**
 * Transforms Plaid balance data to update existing accounts.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param plaid_accounts - Accounts with fresh balances from Plaid
 * @param now - Current timestamp
 * @returns Map of account_id to balance updates
 */
export declare function transform_plaid_balances_to_updates(plaid_accounts: PlaidAccountData[], now: Timestamp): Map<string, {
    current: number;
    available?: number;
    limit?: number;
}>;
/**
 * Maps Plaid account type to display-friendly category.
 *
 * PURE FUNCTION.
 */
export declare function get_account_category(account_type: string, account_subtype: string | null): string;
//# sourceMappingURL=plaid_transformer.d.ts.map