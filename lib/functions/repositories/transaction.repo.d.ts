/**
 * Transaction Repository
 *
 * Handles persistence for transaction entities.
 * All writes are audited automatically.
 *
 * NOTE: This repository uses snake_case internally but maps to/from
 * the legacy camelCase Firestore documents for backwards compatibility.
 *
 * @module repositories/transaction
 */
import { Timestamp } from "firebase-admin/firestore";
import { WriteResult, TraceContext } from "../types";
import { TransactionForPersistence, TransactionSplitForPersistence, PendingTransactionInfo } from "../types/plaid";
/**
 * Legacy Firestore document structure (camelCase).
 * Used for reading/writing to maintain backwards compatibility.
 *
 * NOTE: camelCase is intentional - this interfaces with existing Firestore documents.
 */
interface LegacyTransactionDoc {
    id: string;
    transactionId: string;
    userId?: string;
    ownerId: string;
    groupId: string | null;
    groupIds?: string[];
    isPrivate?: boolean;
    transactionDate: Timestamp;
    accountId: string;
    createdBy: string;
    updatedBy: string;
    currency: string;
    description: string;
    internalDetailedCategory: string | null;
    internalPrimaryCategory: string | null;
    plaidDetailedCategory: string;
    plaidPrimaryCategory: string;
    plaidItemId: string;
    source: "plaid" | "manual" | "import";
    transactionStatus: string;
    type: string | null;
    name: string;
    merchantName: string | null;
    amount?: number;
    isPending?: boolean;
    pendingTransactionId?: string | null;
    splits: LegacySplitDoc[];
    initialPlaidData: {
        plaidAccountId: string;
        plaidMerchantName: string | null;
        plaidName: string;
        plaidTransactionId: string;
        plaidPending: boolean;
        source: "plaid";
    };
    createdAt: Timestamp;
    updatedAt: Timestamp;
    isActive?: boolean;
    isDeleted?: boolean;
    deletionReason?: string;
}
interface LegacySplitDoc {
    splitId: string;
    budgetId: string;
    budgetName?: string;
    monthlyPeriodId: string | null;
    weeklyPeriodId: string | null;
    biWeeklyPeriodId: string | null;
    outflowId?: string | null;
    plaidPrimaryCategory: string;
    plaidDetailedCategory: string;
    internalPrimaryCategory: string | null;
    internalDetailedCategory: string | null;
    amount: number;
    description?: string | null;
    isDefault: boolean;
    isIgnored?: boolean;
    isRefund?: boolean;
    isTaxDeductible?: boolean;
    ignoredReason?: string | null;
    refundReason?: string | null;
    paymentType?: string;
    paymentDate: Timestamp;
    rules: string[];
    tags: string[];
    createdAt: Timestamp;
    updatedAt: Timestamp;
}
/**
 * Transaction Repository
 *
 * All write operations automatically create audit entries.
 */
export declare const transaction_repo: {
    /**
     * Upserts transactions from Plaid sync.
     *
     * For each transaction:
     * - If exists (by plaidTransactionId): updates if materially changed
     * - If new: creates with full data
     *
     * @param ctx - Trace context
     * @param transactions - Transactions ready for persistence
     * @param user_id - User ID
     * @param plaid_item_id - Plaid item ID (for scoping)
     * @returns Upsert results with created/updated counts
     */
    upsert_from_plaid_sync(ctx: TraceContext, transactions: TransactionForPersistence[], user_id: string, plaid_item_id: string): Promise<{
        created: number;
        updated: number;
        results: Array<{
            plaid_transaction_id: string;
            doc_id: string;
            action: "created" | "updated";
        }>;
    }>;
    /**
     * Updates specific fields on a transaction.
     *
     * @param ctx - Trace context
     * @param doc_id - Document ID
     * @param updates - Field updates to apply
     * @returns Write result
     */
    update_transaction_fields(ctx: TraceContext, doc_id: string, updates: Partial<{
        internal_primary_category: string | null;
        internal_detailed_category: string | null;
        splits: TransactionSplitForPersistence[];
        is_pending: boolean;
    }>): Promise<WriteResult>;
    /**
     * Soft-deletes transactions by Plaid transaction IDs.
     *
     * @param ctx - Trace context
     * @param user_id - User ID for verification
     * @param plaid_transaction_ids - Plaid transaction IDs to soft-delete
     * @param reason - Reason for deletion
     * @returns Write results
     */
    soft_delete_by_plaid_ids(ctx: TraceContext, user_id: string, plaid_transaction_ids: string[], reason: string): Promise<WriteResult[]>;
    /**
     * Gets pending transactions for a Plaid item.
     *
     * Used by resolver to build the pending transaction lookup map
     * for pending->posted migration.
     *
     * @param ctx - Trace context
     * @param user_id - User ID
     * @param plaid_item_id - Plaid item ID
     * @returns Map of plaid_transaction_id -> PendingTransactionInfo
     */
    get_pending_transactions_for_item(ctx: TraceContext, user_id: string, plaid_item_id: string): Promise<Map<string, PendingTransactionInfo>>;
    /**
     * Gets a transaction by Plaid transaction ID.
     *
     * @param ctx - Trace context
     * @param user_id - User ID for scoping
     * @param plaid_transaction_id - Plaid transaction ID
     * @returns Transaction info or null if not found
     */
    get_by_plaid_transaction_id(ctx: TraceContext, user_id: string, plaid_transaction_id: string): Promise<{
        doc_id: string;
        created_at: Timestamp;
    } | null>;
    /**
     * Gets transaction by document ID.
     *
     * @param ctx - Trace context
     * @param doc_id - Document ID
     * @returns Transaction document or null
     */
    get_by_id(ctx: TraceContext, doc_id: string): Promise<LegacyTransactionDoc | null>;
    /**
     * Writes the Transaction Assignment Engine's output: the updated splits array
     * (with the engine-owned assignment fields applied) plus the denormalized
     * `splitBudgetIds`. This is the engine's SINGLE write of split assignment.
     *
     * @param _ctx - Trace context
     * @param doc_id - Transaction document ID
     * @param updated_splits - The full splits array, with assignment fields applied
     * @param split_budget_ids - Distinct budget ids across the splits (queryable)
     */
    apply_split_assignments(_ctx: TraceContext, doc_id: string, updated_splits: Array<Record<string, unknown>>, split_budget_ids: string[]): Promise<void>;
    /**
     * Counts active transactions for a specific account.
     *
     * Used by resolvers to determine cascade scope for account removal.
     *
     * @param ctx - Trace context
     * @param account_id - Plaid account ID
     * @param user_id - User ID for scoping
     * @returns Count of active transactions for the account
     */
    count_by_account_id(ctx: TraceContext, account_id: string, user_id: string): Promise<number>;
    /**
     * Gets transaction IDs for a specific account.
     *
     * Used by resolvers to get affected transaction IDs for cascade operations.
     * Returns only IDs to minimize memory usage.
     *
     * @param ctx - Trace context
     * @param account_id - Plaid account ID
     * @param user_id - User ID for scoping
     * @param limit - Maximum number of IDs to return (default 1000)
     * @returns Array of transaction document IDs
     */
    get_ids_by_account_id(ctx: TraceContext, account_id: string, user_id: string, limit?: number): Promise<string[]>;
    /**
     * Gets all active transaction IDs owned by a user.
     *
     * Queries by `userId` (the field the assignment engine + spend recompute use,
     * NOT `ownerId`) so the backfill's work-list matches exactly what
     * `recompute_budget_spent` will sum. Returns only IDs to bound memory.
     *
     * @param ctx - Trace context
     * @param user_id - User ID (matches the `userId` field)
     * @param limit - Maximum number of IDs to return (default 5000)
     * @returns Array of transaction document IDs
     */
    get_ids_by_user_id(ctx: TraceContext, user_id: string, limit?: number): Promise<string[]>;
    /**
     * Gets active transaction IDs that have at least one split assigned to a
     * budget. Splits are nested maps, so this scans the user's active
     * transactions (by ownerId AND userId, deduped) and filters in memory.
     * Used by the delete cascade to re-run assignment on a deleted budget's txns.
     *
     * @param ctx - Trace context
     * @param user_id - User ID
     * @param budget_id - Budget whose referencing transactions to find
     */
    get_ids_referencing_budget(ctx: TraceContext, user_id: string, budget_id: string): Promise<string[]>;
    /**
     * Gets one transaction's raw doc data + id, or null if missing/inactive.
     * Returns the raw camelCase map so the assignment resolver can read-modify-
     * write nested splits onto it.
     */
    get_raw_by_id(_ctx: TraceContext, transaction_id: string): Promise<{
        id: string;
        data: Record<string, unknown>;
    } | null>;
    /**
     * Gets active transactions (raw doc data + id) whose `transactionDate` falls
     * in [start_ms, end_ms]. Returns raw maps so callers (spend / re-home
     * resolvers) can map nested splits themselves.
     *
     * Composite index: `transactions(userId, transactionDate)`.
     */
    get_active_in_date_range(_ctx: TraceContext, user_id: string, start_ms: number, end_ms: number): Promise<Array<{
        id: string;
        data: Record<string, unknown>;
    }>>;
    /**
     * Updates cursor on plaid_item document.
     *
     * NOTE: This updates the plaid_items collection, not transactions.
     * Included here for convenience in the sync orchestrator.
     *
     * @param ctx - Trace context
     * @param item_doc_id - Plaid item document ID
     * @param cursor - New cursor value
     */
    update_plaid_item_cursor(ctx: TraceContext, item_doc_id: string, cursor: string | null): Promise<void>;
};
export {};
//# sourceMappingURL=transaction.repo.d.ts.map