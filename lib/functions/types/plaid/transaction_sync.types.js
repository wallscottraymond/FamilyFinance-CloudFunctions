"use strict";
/**
 * Transaction Sync Types
 *
 * Types for the sync_transactions flow in the 5-layer architecture.
 * This migration focuses ONLY on syncing transactions from Plaid -> Firestore.
 * Budget calculations are handled by existing Firestore triggers.
 *
 * @module types/plaid/transaction_sync
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MATERIAL_AMOUNT_CHANGE_THRESHOLD = exports.PLAID_SYNC_MAX_PAGE_SIZE = exports.PLAID_SYNC_PAGE_DELAY_MS = exports.TRANSACTION_SYNC_RATE_LIMIT_SECONDS = exports.TRANSACTION_SYNC_BUDGET = void 0;
// ============================================================================
// Constants
// ============================================================================
/**
 * Performance budget for transaction sync.
 */
exports.TRANSACTION_SYNC_BUDGET = {
    /** Maximum Firestore read operations */
    max_reads: 200,
    /** Maximum Firestore write operations (high due to bulk sync) */
    max_writes: 600,
    /** Maximum execution time (5 minutes for full sync) */
    max_time_ms: 300000,
};
/**
 * Rate limit for manual transaction sync (in seconds).
 */
exports.TRANSACTION_SYNC_RATE_LIMIT_SECONDS = 300; // 5 minutes
/**
 * Delay between Plaid API pages (to avoid rate limiting).
 */
exports.PLAID_SYNC_PAGE_DELAY_MS = 100;
/**
 * Maximum transactions per Plaid API page.
 */
exports.PLAID_SYNC_MAX_PAGE_SIZE = 500;
/**
 * Threshold for detecting material amount change (in absolute value).
 */
exports.MATERIAL_AMOUNT_CHANGE_THRESHOLD = 0.01;
//# sourceMappingURL=transaction_sync.types.js.map