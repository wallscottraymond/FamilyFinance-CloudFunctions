"use strict";
/**
 * Balance Sync Types
 *
 * Types for the sync_balances flow in the 5-layer architecture.
 *
 * @module types/plaid/balance_sync
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BALANCE_SYNC_RATE_LIMIT_SECONDS = exports.SYNC_BALANCES_BUDGET = void 0;
// ============================================================================
// Constants
// ============================================================================
/**
 * Performance budget for balance sync.
 */
exports.SYNC_BALANCES_BUDGET = {
    /** Maximum Firestore read operations */
    max_reads: 50,
    /** Maximum Firestore write operations */
    max_writes: 100,
    /** Maximum execution time (60 seconds) */
    max_time_ms: 60000,
};
/**
 * Rate limit for manual balance refreshes (in seconds).
 */
exports.BALANCE_SYNC_RATE_LIMIT_SECONDS = 300; // 5 minutes
//# sourceMappingURL=balance_sync.types.js.map