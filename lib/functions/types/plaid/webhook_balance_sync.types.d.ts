/**
 * Webhook Balance Sync Types
 *
 * Types for the webhook-triggered balance sync flow.
 * Separates webhook-specific concerns from the core balance sync logic.
 *
 * @module types/plaid/webhook_balance_sync
 */
import { ClientAccountData } from "./balance_sync.types";
/**
 * Input for webhook-triggered balance sync.
 * Comes from Plaid webhook payload.
 */
export interface WebhookBalanceSyncInput {
    /** Plaid item ID from webhook */
    plaid_item_id: string;
    /** Webhook type (ITEM, TRANSACTIONS, etc.) */
    webhook_type: string;
    /** Webhook code (NEW_ACCOUNTS_AVAILABLE, etc.) */
    webhook_code: string;
    /** Plaid request ID for deduplication */
    request_id?: string;
}
/**
 * Response from webhook balance sync orchestrator.
 */
export interface WebhookBalanceSyncResponse {
    /** Whether the sync succeeded */
    success: boolean;
    /** Number of accounts created (new accounts from Plaid) */
    accounts_created: number;
    /** Number of accounts updated */
    accounts_updated: number;
    /** Number of accounts that failed to update */
    accounts_failed: number;
    /** Updated accounts in client format */
    accounts: ClientAccountData[];
    /** Error message if failed */
    error?: string;
    /** Whether this was skipped (e.g., item not found) */
    skipped?: boolean;
    /** Skip reason */
    skip_reason?: string;
}
/**
 * Dependencies resolved from webhook data.
 */
export interface WebhookBalanceSyncDependencies {
    /** The Plaid item found in database */
    item: {
        doc_id: string;
        plaid_item_id: string;
        user_id: string;
        access_token: string;
        institution_id: string;
        institution_name: string;
        group_id?: string;
    } | null;
    /** Whether the webhook was already processed */
    already_processed: boolean;
}
/**
 * Performance budget for webhook balance sync.
 * Tighter than on-demand sync since webhooks need fast response.
 */
export declare const WEBHOOK_BALANCE_SYNC_BUDGET: {
    /** Maximum Firestore read operations */
    max_reads: number;
    /** Maximum Firestore write operations */
    max_writes: number;
    /** Maximum execution time (20 seconds - webhooks need fast response) */
    max_time_ms: number;
};
//# sourceMappingURL=webhook_balance_sync.types.d.ts.map