"use strict";
/**
 * Plaid Initial Sync Types
 *
 * Types for the plaid_initial_sync_orchestrator flow.
 * This orchestrates the complete initial data sync when a Plaid item is created.
 *
 * @module types/plaid/initial_sync
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.INITIAL_SYNC_BUDGET = void 0;
// ============================================================================
// Constants
// ============================================================================
/**
 * Performance budget for the initial sync orchestrator.
 * This is a long-running operation so budget is generous.
 */
exports.INITIAL_SYNC_BUDGET = {
    /** Maximum Firestore read operations */
    max_reads: 100,
    /** Maximum Firestore write operations (accounts + transactions + recurring) */
    max_writes: 500,
    /** Maximum execution time (9 minutes - close to Cloud Functions max) */
    max_time_ms: 540000,
};
//# sourceMappingURL=initial_sync.types.js.map