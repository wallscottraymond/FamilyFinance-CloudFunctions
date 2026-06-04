"use strict";
/**
 * Webhook Balance Sync Types
 *
 * Types for the webhook-triggered balance sync flow.
 * Separates webhook-specific concerns from the core balance sync logic.
 *
 * @module types/plaid/webhook_balance_sync
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEBHOOK_BALANCE_SYNC_BUDGET = void 0;
// ============================================================================
// Constants
// ============================================================================
/**
 * Performance budget for webhook balance sync.
 * Tighter than on-demand sync since webhooks need fast response.
 */
exports.WEBHOOK_BALANCE_SYNC_BUDGET = {
    /** Maximum Firestore read operations */
    max_reads: 30,
    /** Maximum Firestore write operations */
    max_writes: 50,
    /** Maximum execution time (20 seconds - webhooks need fast response) */
    max_time_ms: 20000,
};
//# sourceMappingURL=webhook_balance_sync.types.js.map