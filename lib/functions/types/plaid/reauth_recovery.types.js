"use strict";
/**
 * Re-authentication Recovery Types
 *
 * Types for confirming that a Plaid item needing re-authentication works again
 * (after the user finishes update-mode Link, or after repairing it elsewhere),
 * then marking it healthy and refreshing its data.
 *
 * @module types/plaid/reauth_recovery
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_REAUTH_PROBES_PER_RUN = exports.CONSENT_RENEWED_AFTER_MS = exports.REAUTH_STATUSES = void 0;
/**
 * Statuses that mean "the user must re-authenticate". Probed by the scheduled
 * self-heal pass and by `complete_relink`.
 */
exports.REAUTH_STATUSES = [
    "item_login_required",
    "pending_expiration",
];
/**
 * Plaid sends PENDING_EXPIRATION 7 days before consent expires. A consent that
 * now expires further out than this has been renewed.
 */
exports.CONSENT_RENEWED_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Most items the scheduled self-heal pass probes per run.
 */
exports.MAX_REAUTH_PROBES_PER_RUN = 50;
//# sourceMappingURL=reauth_recovery.types.js.map