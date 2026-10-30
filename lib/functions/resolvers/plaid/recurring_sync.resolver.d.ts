/**
 * Recurring Sync Resolver
 *
 * Gathers dependencies for the recurring sync orchestrator.
 * - Fetches plaid_item and decrypts access token
 * - Gets user context (family, currency, groups)
 * - Fetches existing manual inflows/outflows for merge detection
 * - Identifies affected cashflow projections
 *
 * @module resolvers/plaid/recurring_sync
 */
import { TraceContext, DependencyResult } from "../../types";
import { ExistingInflowData } from "../../domain/inflow.service";
import { ExistingOutflowData } from "../../domain/outflow.service";
/**
 * Input for recurring sync dependency resolution.
 */
export interface ResolveRecurringSyncInput {
    /** Plaid item document ID (our Firestore doc ID) */
    item_id: string;
    /** User ID */
    user_id: string;
}
/**
 * Plaid item data needed for recurring sync.
 */
export interface PlaidItemForRecurringSync {
    /** Our Firestore document ID */
    doc_id: string;
    /** Plaid's item ID */
    plaid_item_id: string;
    /** Decrypted access token */
    access_token: string;
    /** User who owns this item */
    user_id: string;
    /** Institution ID */
    institution_id: string;
    /** Institution name */
    institution_name: string;
    /** Last recurring sync timestamp */
    last_recurring_sync?: Date | null;
    /** The user has a "Not a bill" / delete memory the planner must honour (C). */
    review_memory?: boolean;
}
/**
 * User context for recurring sync.
 */
export interface RecurringSyncUserContext {
    /** Family ID (if user is in a family) */
    family_id: string | null;
    /** Default currency */
    currency: string;
    /** Group IDs for access control */
    group_ids: string[];
}
/**
 * Full dependencies for recurring sync orchestrator.
 */
export interface RecurringSyncDependencies {
    /** Plaid item data with decrypted token */
    plaid_item: PlaidItemForRecurringSync;
    /** User context */
    user_context: RecurringSyncUserContext;
    /** Existing manual inflows for merge detection */
    existing_manual_inflows: ExistingInflowData[];
    /** Existing manual outflows for merge detection */
    existing_manual_outflows: ExistingOutflowData[];
    /** Existing Plaid inflows for upsert logic */
    existing_plaid_inflow_ids: Set<string>;
    /** Existing Plaid outflows for upsert logic */
    existing_plaid_outflow_ids: Set<string>;
    /** Dependency analysis result */
    dependency_result: DependencyResult;
    /**
     * Plaid account IDs on this item that are still active. Streams on a removed
     * account are dropped, or the sync would re-create/re-activate bills and income
     * the account removal soft-deleted (same rule as the transaction sync).
     */
    active_account_ids: Set<string>;
    /** Plaid account id → account type (`depository` / `credit` / `loan` …) for this item's active
     *  accounts — the capture rules' income gate (X17). Same read as `active_account_ids`. */
    account_types: Map<string, string>;
    /**
     * The user's ACTIVE bills / income (already loaded above), as the capture planner needs them:
     * v2 stamp, Plaid's flag, answers, vendor, dates. Nothing extra is read for this.
     */
    active_records: CaptureRecordInfo[];
}
/** A stored bill / income as the capture planner sees it (a lookup shape, no logic). */
export interface CaptureRecordInfo {
    id: string;
    direction: "outflow" | "inflow";
    is_active: boolean;
    is_hidden: boolean;
    v2: boolean;
    plaid_is_active: boolean | null;
    plaid_inactive_ack_ms: number | null;
    merged_into_id: string | null;
    account_id: string;
    plaid_item_id: string;
    source: string;
    name: string;
    merchant_name: string | null;
    description: string | null;
    average_amount: number;
    frequency: string;
    plaid_status: string;
    plaid_detailed_category: string;
    first_date_ms: number;
    last_date_ms: number;
    removal_intervals: Array<{
        from_ms: number;
        to_ms: number | null;
        mode: string;
    }>;
    transaction_ids: string[];
    /** The user's own name for it (wins over Plaid's merchant / description in `name`). */
    custom_name?: string | null;
    vendor_key?: string | null;
    expected_amount_override?: number | null;
    user_frequency?: string | null;
    absorbed_streams?: import("../../domain/recurring/convert_recurring.service").AbsorbedStream[];
    absorbed_txn_ids?: string[];
}
/** Map a loaded outflow / inflow entity → the planner's lookup shape (no reads). */
export declare function to_capture_record_info(r: {
    id: string;
    is_active: boolean;
    is_hidden: boolean;
    capture_rules_version: number | null;
    plaid_is_active: boolean | null;
    plaid_inactive_ack_at_ms: number | null;
    merged_into_id: string | null;
    account_id: string;
    plaid_item_id: string;
    source: string;
    user_custom_name: string | null;
    description: string | null;
    average_amount: number;
    frequency: string;
    plaid_status: string;
    plaid_detailed_category: string;
    first_date: unknown;
    last_date: unknown;
    removal_intervals: Array<{
        from_ms: number;
        to_ms: number | null;
        mode: string;
    }>;
    transaction_ids: string[];
    vendor_key?: string | null;
    expected_amount_override?: number | null;
    user_frequency?: string | null;
    absorbed_streams?: import("../../domain/recurring/convert_recurring.service").AbsorbedStream[];
    absorbed_txn_ids?: string[];
}, direction: "outflow" | "inflow", merchant_name: string | null): CaptureRecordInfo;
/**
 * Resolves dependencies needed for the recurring sync orchestrator.
 *
 * This resolver:
 * 1. Fetches the plaid_item by doc ID
 * 2. Decrypts the access token
 * 3. Gets user context (family, currency, groups)
 * 4. Fetches existing inflows for merge detection
 * 5. Fetches existing outflows for merge detection
 * 6. Identifies affected cashflow projections
 *
 * @param ctx - Trace context
 * @param input - Recurring sync input
 * @returns Dependencies for the orchestrator, or null if not found
 */
export declare function resolve_recurring_sync_dependencies(ctx: TraceContext, input: ResolveRecurringSyncInput): Promise<RecurringSyncDependencies | null>;
/**
 * Resolves dependencies for webhook-triggered recurring sync.
 *
 * Looks up item by Plaid item ID instead of doc ID.
 *
 * @param ctx - Trace context
 * @param plaid_item_id - Plaid item ID (from webhook)
 * @returns Dependencies for the orchestrator, or null if item not found
 */
export declare function resolve_webhook_recurring_sync_dependencies(ctx: TraceContext, plaid_item_id: string): Promise<RecurringSyncDependencies | null>;
/**
 * Resolves merge suggestions for new recurring items.
 *
 * This is a convenience function that combines the resolver data
 * with domain service functions for merge detection.
 */
export declare function has_potential_merges(dependencies: RecurringSyncDependencies): boolean;
/**
 * Gets IDs of items that need stale detection.
 *
 * Stale detection: If a Plaid stream was previously synced but is no longer
 * returned by Plaid, it may have ended and should be marked inactive.
 */
export declare function get_stale_candidates(dependencies: RecurringSyncDependencies, current_plaid_inflow_ids: string[], current_plaid_outflow_ids: string[]): {
    stale_inflow_ids: string[];
    stale_outflow_ids: string[];
};
//# sourceMappingURL=recurring_sync.resolver.d.ts.map