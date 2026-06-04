"use strict";
/**
 * Item Status Webhook Domain Service
 *
 * Pure business logic for processing item status webhooks.
 * NO async, NO IO, NO side effects - deterministic functions only.
 *
 * @module domain/plaid/item_status_webhook
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.is_transient_error_code = is_transient_error_code;
exports.compute_pending_expiration_update = compute_pending_expiration_update;
exports.compute_error_update = compute_error_update;
exports.compute_login_repaired_update = compute_login_repaired_update;
exports.compute_escalation_update = compute_escalation_update;
exports.compute_permission_revoked_update = compute_permission_revoked_update;
exports.should_trigger_refresh = should_trigger_refresh;
exports.is_successful_relink_webhook = is_successful_relink_webhook;
const firestore_1 = require("firebase-admin/firestore");
const item_status_webhook_types_1 = require("../../types/plaid/item_status_webhook.types");
/**
 * Whether an error code is a transient/rate-limit failure that should be
 * retried silently rather than surfaced to the user. PURE.
 */
function is_transient_error_code(error_code) {
    return (item_status_webhook_types_1.TRANSIENT_ERROR_CODES.includes(error_code) ||
        item_status_webhook_types_1.RATE_LIMIT_ERROR_CODES.includes(error_code));
}
/**
 * Computes the status update for a PENDING_EXPIRATION webhook.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param consent_expiration_time - ISO timestamp when consent expires
 * @returns Status update to apply
 */
function compute_pending_expiration_update(consent_expiration_time) {
    let consent_expires_at = null;
    if (consent_expiration_time) {
        try {
            const expiration_date = new Date(consent_expiration_time);
            consent_expires_at = firestore_1.Timestamp.fromDate(expiration_date);
        }
        catch (_a) {
            // Invalid date format - ignore
        }
    }
    return {
        status: item_status_webhook_types_1.ItemStatusValues.PENDING_EXPIRATION,
        error_code: "PENDING_EXPIRATION",
        error_message: item_status_webhook_types_1.ERROR_CODE_MESSAGES.PENDING_EXPIRATION,
        error_at: firestore_1.Timestamp.now(),
        requires_reauth: true,
        consent_expires_at,
        is_transient: false,
    };
}
/**
 * Computes the status update for an ERROR webhook.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param error_code - The Plaid error code
 * @param error_message - The Plaid error message
 * @returns Status update to apply
 */
function compute_error_update(error_code, error_message) {
    const user_message = item_status_webhook_types_1.ERROR_CODE_MESSAGES[error_code] ||
        error_message ||
        "There was an issue with your bank connection. Please try reconnecting.";
    // Transient failures (institution down, rate limited, internal error) are NOT
    // the user's fault and recover on their own. Mark them silent so the
    // auto-retry job handles them in the background instead of surfacing a
    // "Reconnect" prompt immediately.
    if (item_status_webhook_types_1.RATE_LIMIT_ERROR_CODES.includes(error_code)) {
        return {
            status: item_status_webhook_types_1.ItemStatusValues.RATE_LIMITED,
            error_code,
            error_message: user_message,
            error_at: firestore_1.Timestamp.now(),
            requires_reauth: false,
            consent_expires_at: null,
            is_transient: true,
        };
    }
    if (item_status_webhook_types_1.TRANSIENT_ERROR_CODES.includes(error_code)) {
        return {
            status: item_status_webhook_types_1.ItemStatusValues.TEMPORARY_ERROR,
            error_code,
            error_message: user_message,
            error_at: firestore_1.Timestamp.now(),
            requires_reauth: false,
            consent_expires_at: null,
            is_transient: true,
        };
    }
    // Everything else is treated as requiring re-authentication and is surfaced
    // to the user immediately.
    const requires_reauth = item_status_webhook_types_1.REAUTH_ERROR_CODES.includes(error_code);
    return {
        status: item_status_webhook_types_1.ItemStatusValues.ITEM_LOGIN_REQUIRED,
        error_code,
        error_message: user_message,
        error_at: firestore_1.Timestamp.now(),
        requires_reauth,
        consent_expires_at: null,
        is_transient: false,
    };
}
/**
 * Computes the status update for a LOGIN_REPAIRED webhook.
 * This clears the error state and sets status back to healthy.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @returns Status update to apply
 */
function compute_login_repaired_update() {
    return {
        status: item_status_webhook_types_1.ItemStatusValues.HEALTHY,
        error_code: null,
        error_message: null,
        error_at: null,
        requires_reauth: false,
        consent_expires_at: null,
        is_transient: false,
    };
}
/**
 * Computes the status update that ESCALATES a transient error to the user after
 * it has persisted past the surface threshold. The connection has been failing
 * silently for too long, so we surface it as needing a reconnect (reusing the
 * existing reauth UI — update mode is the available user action).
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param original_error_code - The transient error code that persisted
 * @returns Status update to apply
 */
function compute_escalation_update(original_error_code) {
    return {
        status: item_status_webhook_types_1.ItemStatusValues.ITEM_LOGIN_REQUIRED,
        error_code: original_error_code !== null && original_error_code !== void 0 ? original_error_code : "PERSISTENT_CONNECTION_ERROR",
        error_message: item_status_webhook_types_1.ERROR_CODE_MESSAGES.PERSISTENT_CONNECTION_ERROR,
        error_at: firestore_1.Timestamp.now(),
        requires_reauth: true,
        consent_expires_at: null,
        is_transient: false,
    };
}
/**
 * Computes the status update for a USER_PERMISSION_REVOKED webhook.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @returns Status update to apply
 */
function compute_permission_revoked_update() {
    return {
        status: item_status_webhook_types_1.ItemStatusValues.USER_PERMISSION_REVOKED,
        error_code: "USER_PERMISSION_REVOKED",
        error_message: item_status_webhook_types_1.ERROR_CODE_MESSAGES.USER_PERMISSION_REVOKED,
        error_at: firestore_1.Timestamp.now(),
        requires_reauth: false, // Can't re-auth if permission is revoked
        consent_expires_at: null,
        is_transient: false,
    };
}
/**
 * Determines if a status change should trigger a data refresh.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param previous_status - The previous item status
 * @param new_status - The new item status
 * @returns Whether to trigger a data refresh
 */
function should_trigger_refresh(previous_status, new_status) {
    // Only trigger refresh when connection is repaired
    if (new_status !== item_status_webhook_types_1.ItemStatusValues.HEALTHY) {
        return false;
    }
    // Trigger refresh if coming from an error state
    const error_statuses = [
        item_status_webhook_types_1.ItemStatusValues.ITEM_LOGIN_REQUIRED,
        item_status_webhook_types_1.ItemStatusValues.PENDING_EXPIRATION,
    ];
    return previous_status !== null && error_statuses.includes(previous_status);
}
/**
 * Gets the webhook code that should mark a relink attempt as successful.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param webhook_code - The webhook code received
 * @returns Whether this webhook indicates a successful relink
 */
function is_successful_relink_webhook(webhook_code) {
    return webhook_code === "LOGIN_REPAIRED";
}
//# sourceMappingURL=item_status_webhook.service.js.map