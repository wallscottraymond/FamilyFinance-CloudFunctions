/**
 * Account Repository
 *
 * Handles persistence for account entities.
 * All writes are audited automatically.
 *
 * NOTE: This repository uses snake_case internally but maps to/from
 * the legacy camelCase Firestore documents for backwards compatibility.
 *
 * @module repositories/account
 */
import { Timestamp } from "firebase-admin/firestore";
import { WriteResult, BatchWriteResult, ReadOptions, BaseEntity, AccessMetadata, TraceContext } from "../types";
import { ClientAccountData } from "../types/plaid";
/**
 * Account entity in snake_case (new architecture).
 */
export interface Account extends BaseEntity {
    /** Plaid account ID */
    account_id: string;
    /** Reference to plaid_items */
    item_id: string;
    /** Account name from institution */
    name: string;
    /** Account number mask (e.g., "0000") */
    mask?: string;
    /** Official name from institution */
    official_name?: string;
    /** Account type (depository, credit, loan, investment, other) */
    account_type: string;
    /** Account subtype (checking, savings, credit_card, etc.) */
    account_subtype: string;
    /** Balance information */
    balances: {
        current: number;
        available?: number;
        limit?: number;
        iso_currency_code?: string;
        last_updated: Timestamp;
    };
    /** Institution information */
    institution: {
        id: string;
        name: string;
        logo?: string;
    };
    /** Sync settings */
    is_sync_enabled: boolean;
    last_synced_at?: Timestamp;
    /** Access control metadata */
    access: AccessMetadata;
}
/**
 * Account Repository
 *
 * All write operations automatically create audit entries.
 */
export declare const account_repo: {
    /**
     * Gets an account by ID.
     *
     * @param _ctx - Trace context (for future observability)
     * @param id - Account ID
     * @param options - Read options
     * @returns Account entity or null if not found
     */
    get_by_id(_ctx: TraceContext, id: string, options?: ReadOptions): Promise<Account | null>;
    /**
     * Gets all accounts for a user.
     *
     * @param _ctx - Trace context
     * @param user_id - User ID
     * @param options - Read options
     * @returns Array of account entities
     */
    get_by_user_id(_ctx: TraceContext, user_id: string, options?: ReadOptions): Promise<Account[]>;
    /**
     * Gets accounts by item ID (all accounts linked to a Plaid item).
     *
     * @param _ctx - Trace context
     * @param item_id - Plaid item ID
     * @param options - Read options
     * @returns Array of account entities
     */
    get_by_item_id(_ctx: TraceContext, item_id: string, options?: ReadOptions): Promise<Account[]>;
    /**
     * Saves an account (create or update).
     *
     * @param ctx - Trace context
     * @param entity - Account entity to save
     * @returns Write result
     */
    save(ctx: TraceContext, entity: Account): Promise<WriteResult>;
    /**
     * Saves multiple accounts in a batch.
     *
     * @param ctx - Trace context
     * @param entities - Account entities to save
     * @returns Batch write result
     */
    save_batch(ctx: TraceContext, entities: Account[]): Promise<BatchWriteResult>;
    /**
     * Soft-deletes an account.
     *
     * @param ctx - Trace context
     * @param id - Account ID
     * @param user_id - User performing the delete
     * @returns Write result
     */
    soft_delete(ctx: TraceContext, id: string, user_id: string): Promise<WriteResult>;
    /**
     * Restores a soft-deleted account.
     *
     * @param ctx - Trace context
     * @param id - Account ID
     * @param user_id - User performing the restore
     * @returns Write result
     */
    restore(ctx: TraceContext, id: string, user_id: string): Promise<WriteResult>;
    /**
     * Updates account balances.
     * Optimized update that only touches balance fields.
     *
     * @param ctx - Trace context
     * @param id - Account ID
     * @param balances - New balance information
     * @param user_id - User performing the update
     * @returns Write result
     */
    update_balances(ctx: TraceContext, id: string, balances: {
        current: number;
        available?: number;
        limit?: number;
    }, user_id: string): Promise<WriteResult>;
    /**
     * Counts accounts for a user.
     *
     * @param _ctx - Trace context
     * @param user_id - User ID
     * @param include_deleted - Include soft-deleted accounts
     * @returns Count of accounts
     */
    count_by_user_id(_ctx: TraceContext, user_id: string, include_deleted?: boolean): Promise<number>;
    /**
     * Checks if an account exists.
     *
     * @param _ctx - Trace context
     * @param id - Account ID
     * @returns Whether the account exists
     */
    exists(_ctx: TraceContext, id: string): Promise<boolean>;
    /**
     * Gets an account by Plaid account ID.
     *
     * @param _ctx - Trace context
     * @param plaid_account_id - Plaid account ID
     * @param user_id - User ID for scoping query
     * @returns Account entity or null if not found
     */
    get_by_plaid_account_id(_ctx: TraceContext, plaid_account_id: string, user_id: string): Promise<Account | null>;
    /**
     * Upserts accounts from Plaid data.
     *
     * For each account:
     * - If exists (by plaid_account_id): updates balances only
     * - If new: creates the full account
     *
     * This is the shared logic used by both initial sync and balance refresh.
     *
     * @param ctx - Trace context
     * @param plaid_accounts - Array of Plaid account data
     * @param item_id - Plaid item ID
     * @param user_id - User ID
     * @param institution - Institution info
     * @param group_id - Optional group ID for sharing
     * @returns Upsert results with created/updated counts
     */
    upsert_from_plaid(ctx: TraceContext, plaid_accounts: Array<{
        account_id: string;
        name: string;
        official_name?: string | null;
        type: string;
        subtype?: string | null;
        mask?: string | null;
        balances: {
            current: number | null;
            available?: number | null;
            limit?: number | null;
            iso_currency_code?: string | null;
        };
    }>, item_id: string, user_id: string, institution: {
        id: string;
        name: string;
    }, group_id?: string): Promise<{
        created: number;
        updated: number;
        results: Array<{
            plaid_account_id: string;
            doc_id: string;
            action: "created" | "updated";
            previous_balance?: number;
            new_balance: number;
        }>;
    }>;
    /**
     * Gets accounts for a user in client response format (camelCase).
     *
     * This method is used by orchestrators to return account data
     * directly to the entry layer without additional transformation.
     *
     * @param _ctx - Trace context
     * @param user_id - User ID
     * @param item_id - Optional: filter by Plaid item ID
     * @returns Array of accounts in client format
     */
    get_for_client_response(_ctx: TraceContext, user_id: string, item_id?: string): Promise<ClientAccountData[]>;
};
//# sourceMappingURL=account.repo.d.ts.map