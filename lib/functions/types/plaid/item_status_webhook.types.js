"use strict";
/**
 * Item Status Webhook Types
 *
 * Types for handling Plaid ITEM webhook events that affect item status.
 * Includes PENDING_EXPIRATION, ERROR, and LOGIN_REPAIRED webhooks.
 *
 * @module types/plaid/item_status_webhook
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERROR_CODE_MESSAGES = exports.RATE_LIMIT_ERROR_CODES = exports.TRANSIENT_ERROR_CODES = exports.REAUTH_ERROR_CODES = exports.ItemStatusValues = exports.ITEM_STATUS_WEBHOOK_BUDGET = void 0;
// ============================================================================
// Constants
// ============================================================================
/**
 * Performance budget for item status webhook orchestrators.
 */
exports.ITEM_STATUS_WEBHOOK_BUDGET = {
    max_reads: 3,
    max_writes: 2,
    max_time_ms: 5000,
};
/**
 * Item status values used by the webhook handlers.
 */
exports.ItemStatusValues = {
    /** Connection is healthy */
    HEALTHY: "good",
    /** Re-authentication required */
    ITEM_LOGIN_REQUIRED: "item_login_required",
    /** OAuth consent expiring soon */
    PENDING_EXPIRATION: "pending_expiration",
    /** User revoked access */
    USER_PERMISSION_REVOKED: "user_permission_revoked",
    /** Item was removed */
    REMOVED: "removed",
    /**
     * Transient failure (institution down, internal error, maintenance). Retried
     * silently by the auto-retry job; NOT surfaced to the user during the silent
     * window. Escalates to ITEM_LOGIN_REQUIRED if it persists past the surface
     * threshold.
     */
    TEMPORARY_ERROR: "temporary_error",
    /** Temporarily rate limited by Plaid/the institution. Retried silently. */
    RATE_LIMITED: "rate_limited",
};
/**
 * Error codes that require re-authentication.
 */
exports.REAUTH_ERROR_CODES = [
    "ITEM_LOGIN_REQUIRED",
    "INVALID_CREDENTIALS",
    "INVALID_MFA",
    "USER_SETUP_REQUIRED",
    "MFA_NOT_SUPPORTED",
    "NO_ACCOUNTS",
    "ITEM_NOT_SUPPORTED",
];
/**
 * Transient error codes — the institution/API is temporarily unavailable. These
 * are NOT the user's fault and re-authentication won't help; they recover on
 * their own. The auto-retry job retries them silently and only surfaces an
 * error if they persist past the surface threshold.
 */
exports.TRANSIENT_ERROR_CODES = [
    "INSTITUTION_DOWN",
    "INSTITUTION_NOT_RESPONDING",
    "INSTITUTION_NOT_AVAILABLE",
    "INTERNAL_SERVER_ERROR",
    "PLANNED_MAINTENANCE",
];
/**
 * Rate-limit error codes — back off and retry silently.
 */
exports.RATE_LIMIT_ERROR_CODES = [
    "RATE_LIMIT_EXCEEDED",
    "INSTITUTION_RATE_LIMIT",
];
/**
 * User-friendly error messages for different error codes.
 */
exports.ERROR_CODE_MESSAGES = {
    /* eslint-disable @typescript-eslint/naming-convention */
    ITEM_LOGIN_REQUIRED: "Your bank requires you to verify your identity. Please reconnect your account.",
    INVALID_CREDENTIALS: "Your login credentials have changed. Please reconnect your account.",
    ITEM_LOCKED: "Your account is locked. Please visit your bank's website to unlock it, then reconnect here.",
    PENDING_EXPIRATION: "Your bank connection will expire soon. Please reconnect to maintain access.",
    USER_PERMISSION_REVOKED: "You have revoked access to this bank connection.",
    INSTITUTION_DOWN: "Your bank is temporarily unavailable. We'll keep retrying.",
    INSTITUTION_NOT_RESPONDING: "Your bank isn't responding right now. We'll keep retrying.",
    INSTITUTION_NOT_AVAILABLE: "Your bank is temporarily unavailable. We'll keep retrying.",
    INTERNAL_SERVER_ERROR: "Temporary problem syncing this connection. We'll keep retrying.",
    PLANNED_MAINTENANCE: "Your bank is undergoing maintenance. We'll keep retrying.",
    RATE_LIMIT_EXCEEDED: "This connection is rate limited. We'll keep retrying.",
    INSTITUTION_RATE_LIMIT: "This connection is rate limited. We'll keep retrying.",
    // Shown if a transient problem persists past the surface threshold.
    PERSISTENT_CONNECTION_ERROR: "We've had trouble reaching your bank. Please reconnect.",
    /* eslint-enable @typescript-eslint/naming-convention */
};
//# sourceMappingURL=item_status_webhook.types.js.map