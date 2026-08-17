/**
 * Plaid Item Repository
 *
 * Handles persistence for Plaid item entities.
 * All writes are audited automatically.
 *
 * NOTE: This repository uses snake_case internally but maps to/from
 * the legacy camelCase Firestore documents for backwards compatibility.
 *
 * @module repositories/plaid/plaid_item
 */
import { TraceContext, WriteResult, PlaidItem, PlaidItemStatus } from "../../types";
import { TransientItemToRetry } from "../../types/plaid/transient_error_retry.types";
/**
 * Plaid Item Repository
 *
 * Provides methods for CRUD operations on Plaid items.
 * All write operations automatically create audit entries.
 */
export declare const plaid_item_repo: {
    /**
     * Gets a Plaid item by ID.
     *
     * @param ctx - Trace context
     * @param id - Plaid item ID
     * @returns PlaidItem entity or null if not found
     */
    get_by_id(ctx: TraceContext, id: string): Promise<PlaidItem | null>;
    /**
     * Gets one item's raw doc data + id by DOCUMENT id (resolvers read raw fields
     * like `accessToken`/`cursor`). Null when the doc doesn't exist.
     */
    get_raw_by_id(_ctx: TraceContext, id: string): Promise<{
        id: string;
        data: Record<string, unknown>;
    } | null>;
    /**
     * Gets the active item matching Plaid's EXTERNAL item id (`plaidItemId`),
     * returning the raw doc + id (resolvers map their own dependency shape).
     * Null when no active item matches.
     */
    get_active_raw_by_plaid_item_id(_ctx: TraceContext, plaid_item_id: string): Promise<{
        id: string;
        data: Record<string, unknown>;
    } | null>;
    /**
     * Gets all Plaid items for a user.
     *
     * @param ctx - Trace context
     * @param user_id - User ID
     * @param include_inactive - Include inactive items
     * @returns Array of PlaidItem entities
     */
    get_by_user_id(ctx: TraceContext, user_id: string, include_inactive?: boolean): Promise<PlaidItem[]>;
    /**
     * Gets all ACTIVE items currently in one of the given (transient) statuses,
     * across all users. Used by the auto-retry scheduled job.
     *
     * Queries by `status in [...]` (single-field index — no composite index
     * needed) and filters `isActive` in memory.
     *
     * @param ctx - Trace context
     * @param statuses - Status values to match (max 10 for an `in` query)
     * @returns Lightweight rows describing items to retry
     */
    get_in_transient_state(ctx: TraceContext, statuses: string[]): Promise<TransientItemToRetry[]>;
    /**
     * Lightweight rows for every ACTIVE item across all users — used by the
     * scheduled fallback transaction sync so data still flows if a webhook is missed.
     */
    get_all_active(_ctx: TraceContext): Promise<Array<{
        item_doc_id: string;
        plaid_item_id: string;
        user_id: string;
    }>>;
    /**
     * Gets a Plaid item by user and institution.
     *
     * @param ctx - Trace context
     * @param user_id - User ID
     * @param institution_id - Institution ID
     * @returns PlaidItem entity or null if not found
     */
    get_by_user_and_institution(ctx: TraceContext, user_id: string, institution_id: string): Promise<PlaidItem | null>;
    /**
     * Saves a Plaid item (create or update).
     *
     * @param ctx - Trace context
     * @param entity - PlaidItem entity to save
     * @returns WriteResult
     */
    save(ctx: TraceContext, entity: PlaidItem): Promise<WriteResult>;
    /**
     * Soft-deletes a Plaid item (sets isActive = false).
     *
     * @param ctx - Trace context
     * @param id - Plaid item ID
     * @param user_id - User performing the delete
     * @returns WriteResult
     */
    soft_delete(ctx: TraceContext, id: string, user_id: string): Promise<WriteResult>;
    /**
     * Updates the sync cursor for a Plaid item.
     *
     * @param ctx - Trace context
     * @param id - Plaid item ID
     * @param cursor - New cursor value
     */
    update_cursor(ctx: TraceContext, id: string, cursor: string | null): Promise<void>;
    /**
     * Updates the status of a Plaid item.
     *
     * @param ctx - Trace context
     * @param id - Plaid item ID
     * @param status - New status
     * @param error - Error message (if status indicates error)
     */
    update_status(ctx: TraceContext, id: string, status: PlaidItemStatus, error?: string | null): Promise<void>;
    /**
     * Persists a pre-computed set of camelCase status fields onto a Plaid item.
     * The caller (orchestrator) computes ALL values; the repo only writes them
     * (always stamping `updatedAt`). Used by the item-error, login-repaired, and
     * transient-retry status updates so those orchestrators never touch Firestore
     * directly. No business logic here.
     *
     * @param ctx - Trace context
     * @param id - Plaid item document ID
     * @param fields - Pre-computed camelCase fields to merge onto the item
     */
    apply_field_update(ctx: TraceContext, id: string, fields: Record<string, unknown>): Promise<void>;
    /**
     * Updates the last synced timestamp for a Plaid item.
     *
     * @param ctx - Trace context
     * @param id - Plaid item document ID
     */
    update_last_synced_at(ctx: TraceContext, id: string): Promise<void>;
    /**
     * Checks if a Plaid item exists.
     *
     * @param ctx - Trace context
     * @param id - Plaid item ID
     * @returns Whether the item exists
     */
    exists(ctx: TraceContext, id: string): Promise<boolean>;
    /**
     * Updates the last recurring sync timestamp for a Plaid item.
     *
     * This is separate from lastSyncedAt which tracks transaction sync.
     *
     * @param ctx - Trace context
     * @param id - Plaid item document ID
     */
    update_last_recurring_sync_at(ctx: TraceContext, id: string): Promise<void>;
    /**
     * Stamps `lastWebhookReceived` on the item matching Plaid's EXTERNAL item id
     * (`plaidItemId`). Observability only — lets us confirm webhooks are actually
     * arriving from Plaid (the field was previously written only as null at link
     * time, so a null value was ambiguous). Looks up by external id (NOT the doc
     * id) and does NOT filter on `isActive`, so we still record webhooks for items
     * in an error/expired state. No-op when no item matches.
     *
     * @param ctx - Trace context
     * @param plaid_item_id - Plaid's external item id from the webhook payload
     */
    mark_webhook_received(ctx: TraceContext, plaid_item_id: string): Promise<void>;
};
//# sourceMappingURL=plaid_item.repo.d.ts.map