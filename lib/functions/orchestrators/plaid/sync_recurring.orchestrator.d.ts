/**
 * Sync Recurring Orchestrator
 *
 * Coordinates the recurring transaction synchronization flow:
 * 1. Resolver: Get plaid_item with access token and existing recurring items
 * 2. Integration: Fetch recurring transactions from Plaid
 * 3. Transform: Convert Plaid format to domain format
 * 4. Domain: Validate and compute merge suggestions
 * 5. Repository: Persist inflows/outflows, handle stale detection
 * 6. Update plaid_item with last sync timestamp
 *
 * @module orchestrators/plaid/sync_recurring
 */
import { OrchestratorContext, TraceContext, PerformanceBudget } from "../../types";
/**
 * Input for recurring sync orchestrator.
 */
export interface RecurringSyncInput {
    /** Plaid item document ID */
    item_id: string;
    /** Optional: specific account IDs to sync */
    account_ids?: string[];
    /** Whether this is triggered by a webhook */
    is_webhook?: boolean;
}
/**
 * Input for webhook-triggered recurring sync.
 */
export interface WebhookRecurringSyncInput {
    /** Plaid item ID (from webhook, not our doc ID) */
    plaid_item_id: string;
}
/**
 * Response from recurring sync orchestrator.
 */
export interface RecurringSyncResponse {
    /** Whether sync completed successfully */
    success: boolean;
    /** Number of inflows created/updated */
    inflows_synced: number;
    /** Number of outflows created/updated */
    outflows_synced: number;
    /** Number of inflows marked stale */
    inflows_stale: number;
    /** Number of outflows marked stale */
    outflows_stale: number;
    /** Number of merge suggestions created */
    merge_suggestions: number;
    /** Any errors encountered */
    errors?: string[];
    /** Error message if failed */
    error?: string;
}
/**
 * Performance budget for recurring sync.
 */
export declare const RECURRING_SYNC_BUDGET: PerformanceBudget;
/**
 * Orchestrates the recurring transaction synchronization flow.
 *
 * This orchestrator:
 * 1. Fetches recurring transactions from Plaid
 * 2. Transforms to domain format
 * 3. Validates and detects merge opportunities
 * 4. Persists inflows and outflows
 * 5. Handles stale detection
 * 6. Updates plaid_item timestamp
 *
 * @param ctx - Orchestrator context with input and user info
 * @returns Sync results with counts
 */
export declare function sync_recurring_orchestrator(ctx: OrchestratorContext<RecurringSyncInput>): Promise<RecurringSyncResponse>;
/**
 * Orchestrates recurring sync triggered by a Plaid webhook.
 *
 * Differs from regular sync:
 * - Looks up item by Plaid item ID (not our doc ID)
 * - No idempotency key from client
 *
 * @param ctx - Trace context (no user context for webhooks)
 * @param input - Webhook input with Plaid item ID
 * @returns Sync results
 */
export declare function webhook_recurring_sync_orchestrator(ctx: TraceContext, input: WebhookRecurringSyncInput): Promise<RecurringSyncResponse>;
//# sourceMappingURL=sync_recurring.orchestrator.d.ts.map