/**
 * Outflow Repository
 *
 * Handles persistence for recurring expenses (outflows).
 * Supports Plaid sync with upsert logic.
 *
 * NOTE: This repository uses snake_case internally but maps to/from
 * the legacy camelCase Firestore documents for backwards compatibility.
 *
 * @module repositories/outflow
 */
import { Timestamp } from "firebase-admin/firestore";
import { WriteResult, BatchWriteResult, ReadOptions, TraceContext } from "../types";
import { OutflowForPersistence } from "../integrations/plaid/plaid_recurring_transformer";
import { RemovalInterval } from "../domain/recurring/recurring_suppression.service";
/**
 * Outflow entity in snake_case (internal representation).
 */
export interface Outflow {
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
    expected_amount_override: number | null;
    description: string | null;
    merchant_name: string | null;
    user_custom_name: string | null;
    frequency: string;
    first_date: Timestamp;
    last_date: Timestamp;
    predicted_next_date: Timestamp | null;
    plaid_primary_category: string;
    plaid_detailed_category: string;
    internal_primary_category: string | null;
    internal_detailed_category: string | null;
    expense_type: string;
    is_essential: boolean;
    type?: string;
    status: string;
    source: string;
    plaid_status: string;
    plaid_confidence_level: string | null;
    is_hidden: boolean;
    is_user_modified: boolean;
    transaction_ids: string[];
    tags: string[];
    rules: unknown[];
    removed_by_user: boolean;
    removal_intervals: RemovalInterval[];
    last_synced_at?: Timestamp;
}
/**
 * Outflow Repository
 *
 * All write operations automatically create audit entries.
 */
export declare const outflow_repo: {
    /**
     * Reactivates (un-soft-deletes) the given outflow IDs in batches. The caller
     * decides which IDs to restore; the repo only persists isActive/restoredAt.
     * Returns the number of docs written.
     */
    restore_by_ids(ctx: TraceContext, ids: string[]): Promise<number>;
    /**
     * Persist a user's remove/pause/restore state — the derived `removal_intervals`
     * (source of truth for on-read suppression) + the `removed_by_user` denorm.
     * Preserved across Plaid re-sync by `save_batch`. Records an audit entry.
     */
    set_removal_intervals(ctx: TraceContext, id: string, intervals: RemovalInterval[], removed_by_user: boolean, user_id: string): Promise<WriteResult>;
    /**
     * Permanently delete an outflow doc — irreversible ("Delete permanently").
     */
    hard_delete(ctx: TraceContext, id: string, user_id: string): Promise<WriteResult>;
    /**
     * Gets an outflow by ID.
     */
    get_by_id(_ctx: TraceContext, id: string, options?: ReadOptions): Promise<Outflow | null>;
    /**
     * Gets all outflows for a user.
     */
    get_by_user_id(_ctx: TraceContext, user_id: string, options?: ReadOptions): Promise<Outflow[]>;
    /**
     * Gets outflows by Plaid item ID.
     */
    get_by_plaid_item_id(_ctx: TraceContext, plaid_item_id: string, options?: ReadOptions): Promise<Outflow[]>;
    /**
     * Gets outflows by account ID.
     *
     * Used by resolvers to find recurring outflows linked to a specific account
     * for cascade operations (e.g., account removal).
     *
     * @param ctx - Trace context
     * @param account_id - Plaid account ID
     * @param options - Read options
     * @returns Array of outflow entities linked to this account
     */
    get_by_account_id(ctx: TraceContext, account_id: string, options?: ReadOptions): Promise<Outflow[]>;
    /**
     * Finds an outflow by Plaid stream ID.
     *
     * Since stream_id is used as the document ID, this is a direct lookup.
     */
    find_by_plaid_stream_id(ctx: TraceContext, plaid_stream_id: string): Promise<Outflow | null>;
    /**
     * Finds all outflows by multiple Plaid stream IDs.
     *
     * Returns a Map for efficient lookup.
     */
    find_by_plaid_stream_ids(_ctx: TraceContext, plaid_stream_ids: string[]): Promise<Map<string, Outflow>>;
    /**
     * Saves a batch of outflows with upsert logic.
     *
     * For each outflow:
     * - If exists: update with Plaid data, preserve user modifications
     * - If new: create with pending_review status
     */
    save_batch(ctx: TraceContext, entities: OutflowForPersistence[]): Promise<BatchWriteResult>;
    /**
     * Soft-deletes an outflow.
     */
    soft_delete(ctx: TraceContext, id: string, user_id: string): Promise<WriteResult>;
    /**
     * Marks outflows as inactive when Plaid no longer reports them.
     */
    mark_stale(ctx: TraceContext, stream_ids: string[], user_id: string): Promise<WriteResult[]>;
    /**
     * Mark recurring outflows as HIDDEN (durable exclusion of internal account
     * transfers). `isHidden` is preserved by `save_batch` across re-syncs, so once
     * set it survives Plaid recreating the stream. Idempotent.
     */
    mark_hidden(ctx: TraceContext, stream_ids: string[], hidden: boolean, user_id: string): Promise<WriteResult[]>;
};
//# sourceMappingURL=outflow.repo.d.ts.map