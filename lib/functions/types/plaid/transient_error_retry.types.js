"use strict";
/**
 * Transient Error Auto-Retry Types
 *
 * Types for the scheduled job that silently retries Plaid items in a transient
 * error state (institution down, rate limited, internal error). The item is
 * retried in the background and only surfaced to the user if the failure
 * persists past the surface threshold.
 *
 * @module types/plaid/transient_error_retry
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RETRY_TRANSIENT_ERRORS_BUDGET = exports.MAX_ITEMS_PER_RUN = exports.SURFACE_AFTER_MS = exports.RETRY_SCHEDULE = void 0;
// ============================================================================
// Constants
// ============================================================================
/** How often the scheduled retry job runs (every 4 hours). */
exports.RETRY_SCHEDULE = "0 */4 * * *";
/**
 * How long a transient error may persist (silently retried) before it is
 * surfaced to the user as needing a reconnect. 24 hours.
 */
exports.SURFACE_AFTER_MS = 24 * 60 * 60 * 1000;
/** Max items processed per scheduled run (safety bound). */
exports.MAX_ITEMS_PER_RUN = 200;
/** Performance budget for the retry orchestrator (per item is small; this is the run). */
exports.RETRY_TRANSIENT_ERRORS_BUDGET = {
    max_reads: 250,
    max_writes: 200,
    max_time_ms: 500000,
};
//# sourceMappingURL=transient_error_retry.types.js.map