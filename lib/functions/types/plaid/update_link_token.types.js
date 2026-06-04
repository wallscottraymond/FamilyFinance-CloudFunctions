"use strict";
/**
 * Update Link Token Types
 *
 * Types for the create_update_link_token flow in the 5-layer architecture.
 * Used for re-authentication when Plaid connections enter error states.
 *
 * @module types/plaid/update_link_token
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATUS_ERROR_MESSAGES = exports.STATUSES_REQUIRING_REAUTH = exports.CREATE_UPDATE_LINK_TOKEN_BUDGET = exports.RELINK_ATTEMPT_RETENTION_DAYS = exports.RELINK_ATTEMPT_WINDOW_HOURS = exports.MAX_RELINK_ATTEMPTS_BEFORE_HELP = void 0;
// ============================================================================
// Constants
// ============================================================================
/**
 * Maximum number of re-link attempts before showing help message.
 */
exports.MAX_RELINK_ATTEMPTS_BEFORE_HELP = 3;
/**
 * Time window for counting recent re-link attempts (hours).
 */
exports.RELINK_ATTEMPT_WINDOW_HOURS = 24;
/**
 * Retention period for relink attempt records (days).
 */
exports.RELINK_ATTEMPT_RETENTION_DAYS = 30;
/**
 * Performance budget for create_update_link_token orchestrator.
 */
exports.CREATE_UPDATE_LINK_TOKEN_BUDGET = {
    max_reads: 5,
    max_writes: 1,
    max_time_ms: 5000,
};
/**
 * Plaid item statuses that require re-authentication.
 */
exports.STATUSES_REQUIRING_REAUTH = [
    "item_login_required",
    "pending_expiration",
];
/**
 * Error messages for specific item statuses.
 */
exports.STATUS_ERROR_MESSAGES = {
    /* eslint-disable @typescript-eslint/naming-convention */
    item_locked: "Your account is locked. Please visit your bank's website to unlock it, then try reconnecting here.",
    good: "This connection is healthy and does not require re-authentication.",
    /* eslint-enable @typescript-eslint/naming-convention */
};
//# sourceMappingURL=update_link_token.types.js.map