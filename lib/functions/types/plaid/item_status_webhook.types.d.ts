/**
 * Item Status Webhook Types
 *
 * Types for handling Plaid ITEM webhook events that affect item status.
 * Includes PENDING_EXPIRATION, ERROR, and LOGIN_REPAIRED webhooks.
 *
 * @module types/plaid/item_status_webhook
 */
import { Timestamp } from "firebase-admin/firestore";
/**
 * Input for item status webhook orchestrators.
 */
export interface ItemStatusWebhookInput {
    /** Plaid's item ID (not our document ID) */
    plaid_item_id: string;
    /** The webhook type (always "ITEM" for these) */
    webhook_type: string;
    /** The specific webhook code */
    webhook_code: string;
    /** Plaid request ID for debugging */
    request_id?: string;
    /** Consent expiration date (for PENDING_EXPIRATION) */
    consent_expiration_time?: string;
    /** Error details (for ERROR webhook) */
    error?: {
        error_type: string;
        error_code: string;
        error_message: string;
        display_message: string | null;
    };
}
/**
 * Response from item status webhook orchestrators.
 */
export interface ItemStatusWebhookResponse {
    /** Whether the webhook was processed successfully */
    success: boolean;
    /** Whether the webhook was skipped (e.g., item not found) */
    skipped: boolean;
    /** Reason for skipping if skipped */
    skip_reason?: string;
    /** Error message if failed */
    error?: string;
    /** The document ID of the affected item */
    item_doc_id?: string;
    /** The previous status before update */
    previous_status?: string;
    /** The new status after update */
    new_status?: string;
    /** Whether a data refresh was triggered (for LOGIN_REPAIRED) */
    refresh_triggered?: boolean;
}
/**
 * Input for resolving item status webhook dependencies.
 */
export interface ResolveItemStatusWebhookInput {
    /** Plaid's item ID */
    plaid_item_id: string;
}
/**
 * Dependencies resolved for item status webhooks.
 */
export interface ItemStatusWebhookDependencies {
    /** Whether the item was found */
    item_found: boolean;
    /** The item's document ID */
    item_doc_id: string | null;
    /** The item's user ID */
    user_id: string | null;
    /** Current item status */
    current_status: string | null;
    /** Whether the item is active */
    is_active: boolean;
    /** Institution name for logging */
    institution_name: string | null;
}
/**
 * Item status update to apply.
 */
export interface ItemStatusUpdate {
    /** New status value */
    status: string;
    /** Error code if applicable */
    error_code: string | null;
    /** User-friendly error message */
    error_message: string | null;
    /** When the error occurred */
    error_at: Timestamp | null;
    /** Whether re-authentication is required */
    requires_reauth: boolean;
    /** Consent expiration time (for PENDING_EXPIRATION) */
    consent_expires_at: Timestamp | null;
    /**
     * Whether this is a transient error (institution down, rate limited, etc.)
     * that should be retried silently in the background rather than surfaced to
     * the user immediately. Drives the auto-retry scheduled job.
     */
    is_transient: boolean;
}
/**
 * Performance budget for item status webhook orchestrators.
 */
export declare const ITEM_STATUS_WEBHOOK_BUDGET: {
    max_reads: number;
    max_writes: number;
    max_time_ms: number;
};
/**
 * Item status values used by the webhook handlers.
 */
export declare const ItemStatusValues: {
    /** Connection is healthy */
    readonly HEALTHY: "good";
    /** Re-authentication required */
    readonly ITEM_LOGIN_REQUIRED: "item_login_required";
    /** OAuth consent expiring soon */
    readonly PENDING_EXPIRATION: "pending_expiration";
    /** User revoked access */
    readonly USER_PERMISSION_REVOKED: "user_permission_revoked";
    /** Item was removed */
    readonly REMOVED: "removed";
    /**
     * Transient failure (institution down, internal error, maintenance). Retried
     * silently by the auto-retry job; NOT surfaced to the user during the silent
     * window. Escalates to ITEM_LOGIN_REQUIRED if it persists past the surface
     * threshold.
     */
    readonly TEMPORARY_ERROR: "temporary_error";
    /** Temporarily rate limited by Plaid/the institution. Retried silently. */
    readonly RATE_LIMITED: "rate_limited";
};
/**
 * Error codes that require re-authentication.
 */
export declare const REAUTH_ERROR_CODES: string[];
/**
 * Transient error codes — the institution/API is temporarily unavailable. These
 * are NOT the user's fault and re-authentication won't help; they recover on
 * their own. The auto-retry job retries them silently and only surfaces an
 * error if they persist past the surface threshold.
 */
export declare const TRANSIENT_ERROR_CODES: string[];
/**
 * Rate-limit error codes — back off and retry silently.
 */
export declare const RATE_LIMIT_ERROR_CODES: string[];
/**
 * User-friendly error messages for different error codes.
 */
export declare const ERROR_CODE_MESSAGES: Record<string, string>;
//# sourceMappingURL=item_status_webhook.types.d.ts.map