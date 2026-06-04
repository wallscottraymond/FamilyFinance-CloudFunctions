/**
 * Inflow Repository
 *
 * Handles persistence for recurring income (inflows).
 * Supports Plaid sync with upsert logic.
 *
 * NOTE: This repository uses snake_case internally but maps to/from
 * the legacy camelCase Firestore documents for backwards compatibility.
 *
 * @module repositories/inflow
 */
import { Timestamp } from "firebase-admin/firestore";
import { WriteResult, BatchWriteResult, ReadOptions, TraceContext } from "../types";
import { InflowForPersistence } from "../integrations/plaid/plaid_recurring_transformer";
/**
 * Inflow entity in snake_case (internal representation).
 */
export interface Inflow {
    id: string;
    user_id: string;
    group_ids: string[];
    is_active: boolean;
    created_at: Timestamp;
    updated_at: Timestamp;
    plaid_item_id: string;
    plaid_stream_id: string;
    account_id: string;
    last_amount: number;
    average_amount: number;
    amount_min?: number;
    amount_max?: number;
    currency: string;
    description: string | null;
    payer_name: string | null;
    user_custom_name: string | null;
    frequency: string;
    first_date: Timestamp;
    last_date: Timestamp;
    predicted_next_date: Timestamp | null;
    plaid_primary_category: string;
    plaid_detailed_category: string;
    internal_primary_category: string | null;
    internal_detailed_category: string | null;
    income_type: string;
    is_regular_salary: boolean;
    is_variable: boolean;
    status: string;
    source: string;
    plaid_status: string;
    plaid_confidence_level: string | null;
    is_hidden: boolean;
    is_user_modified: boolean;
    transaction_ids: string[];
    tags: string[];
    rules: unknown[];
    last_synced_at?: Timestamp;
}
/**
 * Inflow Repository
 *
 * All write operations automatically create audit entries.
 */
export declare const inflow_repo: {
    /**
     * Gets an inflow by ID.
     */
    get_by_id(_ctx: TraceContext, id: string, options?: ReadOptions): Promise<Inflow | null>;
    /**
     * Gets all inflows for a user.
     */
    get_by_user_id(_ctx: TraceContext, user_id: string, options?: ReadOptions): Promise<Inflow[]>;
    /**
     * Gets inflows by Plaid item ID.
     */
    get_by_plaid_item_id(_ctx: TraceContext, plaid_item_id: string, options?: ReadOptions): Promise<Inflow[]>;
    /**
     * Gets inflows by account ID.
     *
     * Used by resolvers to find recurring inflows linked to a specific account
     * for cascade operations (e.g., account removal).
     *
     * @param ctx - Trace context
     * @param account_id - Plaid account ID
     * @param options - Read options
     * @returns Array of inflow entities linked to this account
     */
    get_by_account_id(ctx: TraceContext, account_id: string, options?: ReadOptions): Promise<Inflow[]>;
    /**
     * Finds an inflow by Plaid stream ID.
     *
     * Since stream_id is used as the document ID, this is a direct lookup.
     */
    find_by_plaid_stream_id(ctx: TraceContext, plaid_stream_id: string): Promise<Inflow | null>;
    /**
     * Finds all inflows by multiple Plaid stream IDs.
     *
     * Returns a Map for efficient lookup.
     */
    find_by_plaid_stream_ids(_ctx: TraceContext, plaid_stream_ids: string[]): Promise<Map<string, Inflow>>;
    /**
     * Saves a batch of inflows with upsert logic.
     *
     * For each inflow:
     * - If exists: update with Plaid data, preserve user modifications
     * - If new: create with pending_review status
     */
    save_batch(ctx: TraceContext, entities: InflowForPersistence[]): Promise<BatchWriteResult>;
    /**
     * Soft-deletes an inflow.
     */
    soft_delete(ctx: TraceContext, id: string, user_id: string): Promise<WriteResult>;
    /**
     * Marks inflows as inactive when Plaid no longer reports them.
     */
    mark_stale(ctx: TraceContext, stream_ids: string[], user_id: string): Promise<WriteResult[]>;
};
//# sourceMappingURL=inflow.repo.d.ts.map